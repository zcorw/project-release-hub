#!/usr/bin/env python3
"""Update the loopback-only Zhixu container and record verified image identity."""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}\Z")
REGISTRY_DIGEST = re.compile(r"[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}\Z")
ROOT = Path(__file__).resolve().parent.parent
FIXED_ENVIRONMENT = {"PORT": "4310", "HUB_BIND_HOST": "0.0.0.0", "HUB_DATA_DIR": "/app/data"}
OPTIONAL_ENVIRONMENT = ("GITHUB_TOKEN", "HUB_MCP_TOKEN", "HUB_PUBLIC_URL", "HUB_SESSION_SECRET", "HUB_TRUST_PROXY")


def resolved_environment(app):
    # Compose config doubles literal dollars for reusable output, including JSON.
    # Docker receives the original value; compare against inspect without that escaping.
    return {key: value.replace("$$", "$") for key, value in app.get("environment", {}).items() if value is not None}


class UpdateError(RuntimeError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, value):
    """Publish one complete record, with no partially written successful state."""
    fd, temporary = tempfile.mkstemp(prefix=".record-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def update_lock(state, lock_path=None):
    try:
        import fcntl
    except ImportError as error:
        raise UpdateError("Run updates on Linux with Python 3 and Docker Compose v2.") from error
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    if state.is_symlink() or not state.is_dir():
        raise UpdateError("The state directory must be a real private directory.")
    if stat.S_IMODE(state.stat().st_mode) & 0o077:
        raise UpdateError("State directory must be private (chmod 700 .deploy).")
    # A single host-wide target lock also serializes separate repository copies.
    lock_path = lock_path or Path("/tmp/zhixu-image-update.lock")
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a") as handle:
        metadata = os.fstat(handle.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid():
            raise UpdateError("The host-wide update lock must be owned by this operator.")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise UpdateError("Another update/status operation holds the update lock.") from error
        yield


class Updater:
    def __init__(self, root=ROOT, state=None, timeout=120):
        self.root = root.resolve()
        self.state = state or self.root / ".deploy"
        self.timeout = timeout
        self.latest = self.state / "latest-image.json"
        self.pending = self.state / "pending-update.json"
        self.overlay = self.state / "selected-image.json"
        self.env_file = self.root / ".env"
        self.compose = [
            "docker", "compose", "--project-directory", str(self.root),
            "--project-name", "zhixu", "--env-file", os.devnull,
            "-f", str(self.root / "compose.yml"),
        ]

    def run(self, args, timeout=120, capture=True):
        environment = os.environ.copy()
        # Explicit files/project plus a clean Compose environment prevent ambient overrides.
        for key in list(environment):
            if key.startswith("COMPOSE_"):
                del environment[key]
        try:
            result = subprocess.run(
                args, cwd=self.root, env=environment, text=True,
                stdout=subprocess.PIPE if capture else None,
                stderr=subprocess.PIPE if capture else None,
                timeout=timeout, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise UpdateError(f"Command did not complete: {args[0]} {args[1]}") from error
        if result.returncode:
            # Do not echo arbitrary Compose output or environment values into state/logs.
            raise UpdateError(f"Command failed ({result.returncode}): {args[0]} {args[1]}")
        return (result.stdout or "").strip()

    def docker_json(self, *args):
        try:
            return json.loads(self.run(["docker", *args]))
        except (ValueError, TypeError) as error:
            raise UpdateError("Docker returned invalid JSON.") from error

    def validate_config(self):
        if os.environ.get("DOCKER_HOST") or os.environ.get("DOCKER_CONTEXT"):
            raise UpdateError("Unset DOCKER_HOST/DOCKER_CONTEXT; run directly on the VPS using its local Docker context.")
        contexts = self.docker_json("context", "inspect")
        if len(contexts) != 1 or not contexts[0].get("Endpoints", {}).get("docker", {}).get("Host", "").startswith("unix://"):
            raise UpdateError("Only a local Linux Docker engine is supported; remote contexts are refused.")
        # Resolve only this checkout's .env; Compose retains normal shell precedence.
        self.compose[self.compose.index("--env-file") + 1] = str(self.env_file) if self.env_file.exists() else os.devnull
        config = json.loads(self.run(self.compose + ["config", "--format", "json"]))
        if set(config.get("services", {})) != {"app"}:
            raise UpdateError("Expected the single app service in compose.yml.")
        app = config["services"]["app"]
        ports = app.get("ports", [])
        if len(ports) != 1 or ports[0].get("host_ip") != "127.0.0.1":
            raise UpdateError("The app must publish exactly one loopback-only port.")
        if int(ports[0].get("target", 0)) != 4310 or str(ports[0].get("published")) != "4310":
            raise UpdateError("This updater requires the reviewed 4310:4310 port mapping.")
        if app.get("network_mode") or not app.get("read_only") or app.get("privileged"):
            raise UpdateError("Unexpected container network/filesystem/security configuration.")
        if "ALL" not in app.get("cap_drop", []) or "no-new-privileges:true" not in app.get("security_opt", []):
            raise UpdateError("Expected dropped capabilities and no-new-privileges.")
        environment = app.get("environment") or {}
        if not isinstance(environment, dict) or set(environment) - set(FIXED_ENVIRONMENT) - set(OPTIONAL_ENVIRONMENT):
            raise UpdateError("Only the documented GitHub/MCP/OAuth environment settings are allowed.")
        if any(environment.get(key) != value for key, value in FIXED_ENVIRONMENT.items()):
            raise UpdateError("Container PORT, HUB_BIND_HOST and HUB_DATA_DIR must retain their fixed values.")
        if any(value is not None and not isinstance(value, str) for value in environment.values()):
            raise UpdateError("Container environment values must be strings or unset.")
        if app.get("env_file") or app.get("command") or app.get("entrypoint"):
            raise UpdateError("Custom environment files, commands and entrypoints are not supported.")
        self.environment = resolved_environment(app)
        mounts = app.get("volumes", [])
        if len(mounts) != 1 or mounts[0].get("type") != "volume" or mounts[0].get("target") != "/app/data" or mounts[0].get("read_only"):
            raise UpdateError("Expected one writable named SQLite volume at /app/data.")
        self.volume = config.get("volumes", {}).get(mounts[0]["source"], {}).get("name")
        if self.volume != "zhixu_zhixu-data":
            raise UpdateError("Refusing to change the existing zhixu_zhixu-data volume.")
        return config

    def environment_matches(self, container):
        actual = dict(item.split("=", 1) for item in container.get("Config", {}).get("Env", []) if "=" in item)
        return all(actual.get(key) == self.environment.get(key) for key in (*FIXED_ENVIRONMENT, *OPTIONAL_ENVIRONMENT))

    def current(self):
        ids = self.run(self.compose + ["ps", "--all", "--quiet", "app"]).split()
        if len(ids) > 1:
            raise UpdateError("Multiple app containers found; refusing an ambiguous update.")
        if not ids:
            return None
        result = self.docker_json("inspect", ids[0])
        if len(result) != 1:
            raise UpdateError("Could not inspect exactly one app container.")
        container = result[0]
        labels = container.get("Config", {}).get("Labels", {})
        if labels.get("com.docker.compose.project") != "zhixu" or labels.get("com.docker.compose.service") != "app":
            raise UpdateError("The inspected container belongs to a different Compose service.")
        mounts = [m for m in container.get("Mounts", []) if m.get("Destination") == "/app/data"]
        if len(mounts) != 1 or mounts[0].get("Type") != "volume" or mounts[0].get("Name") != self.volume or not mounts[0].get("RW"):
            raise UpdateError("Existing container storage does not match the named SQLite volume.")
        return container

    def volume_exists(self):
        names = self.run(["docker", "volume", "ls", "--format", "{{.Name}}", "--filter", "name=^" + self.volume + "$"]).splitlines()
        return self.volume in names

    def image(self, reference):
        images = self.docker_json("image", "inspect", reference)
        if len(images) != 1 or not IMAGE_ID.fullmatch(images[0].get("Id", "")):
            raise UpdateError("Cannot resolve one immutable Docker image ID.")
        image = images[0]
        config = image.get("Config", {})
        health = config.get("Healthcheck", {}).get("Test", [])
        if not health or health[0] == "NONE" or config.get("User") not in ("node", "1000", "1000:1000"):
            raise UpdateError("Candidate requires the reviewed non-root user and a health check.")
        env = dict(item.split("=", 1) for item in config.get("Env", []) if "=" in item)
        if env.get("HUB_DATA_DIR") != "/app/data" or env.get("PORT") != "4310":
            raise UpdateError("Candidate must use /app/data and port 4310.")
        return image

    def backup(self, container, run_id):
        if not container.get("State", {}).get("Running"):
            raise UpdateError("The existing app must be running for a consistent online backup.")
        target = f"/app/data/backup-before-update-{run_id}.db"
        destination = self.state / "backups" / f"hub-{run_id}.db"
        destination.parent.mkdir(mode=0o700, exist_ok=True)
        self.run(["docker", "exec", container["Id"], "node", "--import", "tsx", "scripts/backup.ts", target], timeout=600)
        self.run(["docker", "cp", container["Id"] + ":" + target, str(destination)], timeout=600)
        if not destination.is_file() or destination.stat().st_size == 0:
            raise UpdateError("Backup copy is missing or empty; no replacement will occur.")
        return str(destination)

    def start(self, image_id):
        # An image ID cannot be retargeted like a mutable tag. No implicit pull/build.
        atomic_json(self.overlay, {"services": {"app": {"image": image_id}}})
        self.run(self.compose + ["-f", str(self.overlay), "up", "--detach", "--no-deps", "--no-build", "--pull", "never", "--force-recreate", "app"], timeout=180)

    def healthy(self, image_id):
        deadline = time.monotonic() + self.timeout
        while True:
            container = self.current()
            if not container or container.get("Image") != image_id:
                raise UpdateError("Running container does not use the selected immutable image ID.")
            state = container.get("State", {})
            health = state.get("Health", {}).get("Status")
            if state.get("Running") and health == "healthy":
                if not self.environment_matches(container):
                    raise UpdateError("Running container environment differs from the selected .env/shell settings.")
                return container
            if health == "unhealthy" or state.get("Status") in ("exited", "dead"):
                raise UpdateError("Updated container failed its health check.")
            if time.monotonic() >= deadline:
                raise UpdateError("Timed out waiting for the updated container's health check.")
            time.sleep(2)

    def status(self):
        self.validate_config()
        container = self.current()
        return {
            "actualImageId": container.get("Image") if container else None,
            "actualHealth": container.get("State", {}).get("Health", {}).get("Status") if container else None,
            "environmentMatches": self.environment_matches(container) if container else None,
            "latestSuccessful": json.loads(self.latest.read_text(encoding="utf-8")) if self.latest.exists() else None,
            "pendingAttempt": json.loads(self.pending.read_text(encoding="utf-8")) if self.pending.exists() else None,
        }

    def update(self, registry_image=None, rollback=None, recover=False):
        configuration = self.validate_config()
        if recover:
            if not self.pending.exists():
                raise UpdateError("No interrupted attempt exists to verify.")
            record = json.loads(self.pending.read_text(encoding="utf-8"))
            if record.get("volume") != self.volume:
                raise UpdateError("The interrupted attempt uses a different data volume.")
            self.healthy(record["imageId"])
            return self.finish(record)
        if self.pending.exists() and not rollback:
            raise UpdateError("An unfinished update exists. Use --status, then --recover or an explicit --rollback IMAGE_ID after reviewing the database.")
        checkout = self.run(["git", "rev-parse", "HEAD"])
        if not re.fullmatch(r"[a-f0-9]{40,64}", checkout):
            raise UpdateError("Expected a committed Git checkout.")
        if self.run(["git", "status", "--porcelain", "--untracked-files=normal"]):
            raise UpdateError("Commit or remove source changes before updating; the build must match the recorded checkout.")
        old = self.current()
        # A rollback may follow a failed startup. Preserve the previous backup in the journal.
        prior_attempt = json.loads(self.pending.read_text(encoding="utf-8")) if self.pending.exists() else None
        if not old and self.volume_exists():
            if not rollback or not prior_attempt or not Path(prior_attempt.get("backupPath") or "").is_file():
                raise UpdateError("A persisted data volume exists without its app container. Restart the previous image and take a backup before updating; no image will start.")
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:12]
        if rollback:
            if not IMAGE_ID.fullmatch(rollback):
                raise UpdateError("Rollback requires an exact local sha256 image ID from --status.")
            selected = rollback
            mode = "rollback"
        elif registry_image:
            if not REGISTRY_DIGEST.fullmatch(registry_image):
                raise UpdateError("--image requires an immutable registry/repository@sha256 digest, not a tag.")
            self.run(["docker", "pull", registry_image], timeout=1800, capture=False)
            selected = registry_image
            mode = "pull"
        else:
            selected = f"zhixu:build-{checkout[:12]}-{run_id.lower()}"
            self.run(["docker", "build", "--pull", "--label", f"org.opencontainers.image.revision={checkout}", "--tag", selected, "."], timeout=3600, capture=False)
            mode = "build"
        candidate = self.image(selected)
        backup = prior_attempt.get("backupPath") if rollback and prior_attempt else None
        if old:
            if rollback and not old.get("State", {}).get("Running"):
                if not prior_attempt or not Path(prior_attempt.get("backupPath") or "").is_file():
                    raise UpdateError("Stopped container has no retained pre-update backup. Preserve/review the database manually before recovery.")
                backup = prior_attempt["backupPath"]
            else:
                backup = self.backup(old, run_id)
        if self.run(["git", "rev-parse", "HEAD"]) != checkout or self.run(["git", "status", "--porcelain", "--untracked-files=normal"]):
            raise UpdateError("Source changed during preparation; refusing replacement.")
        if self.validate_config() != configuration:
            raise UpdateError("Compose or environment settings changed during preparation; refusing replacement.")
        # Recheck before replacement; never overwrite a concurrent external container change.
        actual = self.current()
        if (actual or {}).get("Id") != (old or {}).get("Id") or (actual or {}).get("Image") != (old or {}).get("Image"):
            raise UpdateError("Container changed during preparation; refusing replacement.")
        record = {
            "schemaVersion": 1, "operation": mode, "attemptId": run_id,
            "startedAt": now(), "imageId": candidate["Id"],
            "requestedReference": selected, "registryDigest": registry_image,
            "repoDigests": candidate.get("RepoDigests", []),
            "imageRevision": (candidate.get("Config", {}).get("Labels") or {}).get("org.opencontainers.image.revision"),
            "checkoutCommit": checkout, "volume": self.volume, "backupPath": backup,
            "previousImageId": old.get("Image") if old else (prior_attempt.get("previousImageId") if prior_attempt else None),
            "supersededAttempt": {key: prior_attempt.get(key) for key in ("attemptId", "imageId", "previousImageId", "backupPath")} if prior_attempt else None,
            "previousSuccessful": json.loads(self.latest.read_text(encoding="utf-8")) if self.latest.exists() else None,
        }
        # Retain a bounded previous success record, not a recursively growing history.
        if record["previousSuccessful"]:
            record["previousSuccessful"].pop("previousSuccessful", None)
        atomic_json(self.pending, record)
        self.start(candidate["Id"])
        self.healthy(candidate["Id"])
        return self.finish(record)

    def finish(self, record):
        record = {**record, "verifiedAt": now()}
        atomic_json(self.latest, record)
        # A crash between these operations is recoverable: --recover verifies again.
        self.pending.unlink()
        return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--image", help="Pull an explicitly selected immutable registry digest")
    modes.add_argument("--rollback", metavar="IMAGE_ID", help="Explicit image-only rollback; never restores SQLite")
    modes.add_argument("--status", action="store_true", help="Compare actual container with saved successful/pending state")
    modes.add_argument("--recover", action="store_true", help="Verify and record a healthy interrupted candidate")
    parser.add_argument("--timeout", type=int, default=120, help="Health wait in seconds (1-1800)")
    args = parser.parse_args()
    if not 1 <= args.timeout <= 1800:
        parser.error("--timeout must be between 1 and 1800")
    os.umask(0o077)
    updater = Updater(timeout=args.timeout)
    def interrupted(signum, frame):
        raise UpdateError("Interrupted; inspect --status before retrying. No automatic database downgrade was attempted.")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        with update_lock(updater.state):
            result = updater.status() if args.status else updater.update(args.image, args.rollback, args.recover)
            print(json.dumps(result, indent=2))
    except (UpdateError, OSError, ValueError, KeyError) as error:
        print(f"Update failed: {error}", file=sys.stderr)
        print("No failed candidate is recorded as successful. Inspect --status; review the backup and schema compatibility before an explicit rollback. No volumes/images were deleted.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
