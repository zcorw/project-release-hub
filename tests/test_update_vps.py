"""Isolated updater regressions and optional disposable Compose checks; never contacts a VPS."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import uuid

SPEC = importlib.util.spec_from_file_location("update_vps", Path(__file__).parents[1] / "scripts" / "update-vps.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
OLD = "sha256:" + "a" * 64
NEW = "sha256:" + "b" * 64
DIGEST = "example.com/team/zhixu@sha256:" + "c" * 64
COMMIT = "d" * 40


class FakeUpdater(module.Updater):
    def __init__(self, root):
        super().__init__(root, timeout=1)
        self.state.mkdir()
        self.calls = []
        self.fail = None
        self.current_id = OLD
        self.container_id = "old-container"
        self.running = True
        self.health = "healthy"
        self.dirty = False
        self.existing_volume = True
        self.mount = "zhixu_zhixu-data"
        self.candidate_id = NEW
        self.active_environment = dict(module.FIXED_ENVIRONMENT)
        self.config = {
            "services": {"app": {
                "environment": dict(module.FIXED_ENVIRONMENT),
                "ports": [{"host_ip": "127.0.0.1", "target": 4310, "published": "4310"}],
                "read_only": True, "cap_drop": ["ALL"],
                "security_opt": ["no-new-privileges:true"],
                "volumes": [{"type": "volume", "target": "/app/data", "source": "zhixu-data"}],
            }},
            "volumes": {"zhixu-data": {"name": self.mount}},
        }
        self.candidate = {"Id": NEW, "RepoDigests": [], "Config": {
            "User": "node", "Healthcheck": {"Test": ["CMD", "node", "check"]},
            "Env": ["PORT=4310", "HUB_DATA_DIR=/app/data"],
            "Labels": {"org.opencontainers.image.revision": COMMIT},
        }}

    def run(self, args, timeout=120, capture=True):
        self.calls.append(args)
        if args[0] == "git":
            return COMMIT if args[1] == "rev-parse" else (" M tracked" if self.dirty else "")
        if args[:2] == ["docker", "compose"]:
            if "config" in args:
                return json.dumps(self.config)
            if "ps" in args:
                return self.container_id if self.current_id else ""
            if "up" in args:
                if self.fail == "start":
                    raise module.UpdateError("simulated start failure")
                self.current_id = json.loads(self.overlay.read_text())["services"]["app"]["image"]
                self.container_id = "new-container"
                self.health = "unhealthy" if self.fail == "health" else "healthy"
                self.running = True
                self.active_environment = {key: value for key, value in self.config["services"]["app"]["environment"].items() if value is not None}
                return ""
        if args[:3] == ["docker", "context", "inspect"]:
            return json.dumps([{"Endpoints": {"docker": {"Host": "unix:///var/run/docker.sock"}}}])
        if args[:3] == ["docker", "volume", "ls"]:
            return "zhixu_zhixu-data" if self.existing_volume else ""
        if args[:2] == ["docker", "inspect"]:
            if self.fail == "identity" and self.container_id == "new-container":
                self.current_id = OLD
            return json.dumps([{
                "Id": self.container_id, "Image": self.current_id,
                "Config": {
                    "Labels": {"com.docker.compose.project": "zhixu", "com.docker.compose.service": "app"},
                    "Env": [key + "=" + value for key, value in self.active_environment.items()],
                },
                "Mounts": [{"Type": "volume", "Destination": "/app/data", "Name": self.mount, "RW": True}],
                "State": {"Running": self.running, "Status": "running" if self.running else "exited", "Health": {"Status": self.health}},
            }])
        if args[:3] == ["docker", "image", "inspect"]:
            result = {**self.candidate}
            if args[3] == OLD:
                result["Id"] = OLD
            return json.dumps([result])
        if args[:2] in (["docker", "build"], ["docker", "pull"], ["docker", "exec"], ["docker", "cp"]):
            if args[1] == self.fail:
                raise module.UpdateError("simulated " + self.fail + " failure")
            if args[1] == "cp":
                Path(args[-1]).write_bytes(b"SQLite backup placeholder")
            return ""
        raise AssertionError("Unexpected command: " + repr(args))


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.updater = FakeUpdater(Path(self.temp.name))

    def started(self):
        return any("up" in args for args in self.updater.calls)

    def test_build_records_actual_id_after_health_and_preserves_volume(self):
        record = self.updater.update()
        self.assertEqual(record["imageId"], NEW)
        self.assertEqual(record["previousImageId"], OLD)
        self.assertEqual(record["checkoutCommit"], COMMIT)
        self.assertEqual(record["imageRevision"], COMMIT)
        self.assertEqual(record["volume"], "zhixu_zhixu-data")
        self.assertTrue(Path(record["backupPath"]).is_file())
        self.assertEqual(json.loads(self.updater.latest.read_text()), record)
        self.assertFalse(self.updater.pending.exists())
        start = next(a for a in self.updater.calls if "up" in a)
        self.assertIn("--no-build", start)
        self.assertEqual(start[start.index("--pull") + 1], "never")
        self.assertEqual(json.loads(self.updater.overlay.read_text())["services"]["app"]["image"], NEW)
        self.assertFalse(any(arg in ("down", "prune", "rm") for call in self.updater.calls for arg in call))

    def test_pull_records_registry_digest_separately_from_local_id_and_checkout(self):
        self.updater.candidate["Config"]["Labels"] = None
        record = self.updater.update(registry_image=DIGEST)
        self.assertEqual(record["registryDigest"], DIGEST)
        self.assertEqual(record["imageId"], NEW)
        self.assertIsNone(record["imageRevision"])
        self.assertEqual(record["checkoutCommit"], COMMIT)
        self.assertFalse(any("build" in a for a in self.updater.calls))

    def test_mutable_tag_rejected(self):
        with self.assertRaises(module.UpdateError):
            self.updater.update(registry_image="example.com/team/zhixu:latest")
        self.assertFalse(self.started())

    def test_dirty_checkout_rejected(self):
        self.updater.dirty = True
        with self.assertRaises(module.UpdateError):
            self.updater.update()
        self.assertFalse(self.started())

    def test_project_env_is_used_for_build_pull_status_and_recovery(self):
        self.updater.env_file.write_text("# disposable fixture only\n", encoding="utf-8")
        for registry_image in (None, DIGEST):
            with self.subTest(registry_image=registry_image):
                self.updater.update(registry_image=registry_image)
                self.updater.status()
        for call in self.updater.calls:
            if call[:2] == ["docker", "compose"]:
                self.assertEqual(call[call.index("--env-file") + 1], str(self.updater.env_file))
        self.updater.fail = "health"
        with self.assertRaises(module.UpdateError):
            self.updater.update(registry_image=DIGEST)
        self.updater.health = "healthy"
        self.updater.update(recover=True)

    def test_missing_env_uses_empty_file_and_unset_options_are_accepted(self):
        self.updater.config["services"]["app"]["environment"].update({key: None for key in module.OPTIONAL_ENVIRONMENT})
        self.updater.update()
        self.assertEqual(self.updater.compose[self.updater.compose.index("--env-file") + 1], os.devnull)
        self.assertTrue(self.updater.status()["environmentMatches"])

    def test_only_documented_environment_and_fixed_container_paths_are_allowed(self):
        environment = self.updater.config["services"]["app"]["environment"]
        for key, value in (("NODE_OPTIONS", "--inspect=0.0.0.0"), ("PORT", "5000"), ("HUB_BIND_HOST", "127.0.0.1"), ("HUB_DATA_DIR", "./data")):
            with self.subTest(key=key):
                environment.clear()
                environment.update(module.FIXED_ENVIRONMENT)
                environment[key] = value
                with self.assertRaises(module.UpdateError):
                    self.updater.update()
                self.assertFalse(self.started())

    def test_secrets_reach_container_but_not_commands_records_or_status(self):
        secret = "fixture-only-secret-" * 4
        self.updater.config["services"]["app"]["environment"].update({
            "GITHUB_TOKEN": secret, "HUB_MCP_TOKEN": secret, "HUB_SESSION_SECRET": secret,
        })
        self.updater.update(registry_image=DIGEST)
        self.assertEqual(self.updater.active_environment["HUB_MCP_TOKEN"], secret)
        self.assertNotIn(secret, json.dumps(self.updater.calls))
        self.assertNotIn(secret, json.dumps(self.updater.status()))
        for path in (self.updater.latest, self.updater.overlay):
            self.assertNotIn(secret, path.read_text())
        self.updater.fail = "start"
        with self.assertRaises(module.UpdateError):
            self.updater.update(registry_image=DIGEST)
        self.assertNotIn(secret, self.updater.pending.read_text())
        self.assertNotIn(secret, json.dumps(self.updater.status()))

    def test_config_changes_during_preparation_stop_before_replacement(self):
        original = self.updater.run

        def changing(args, **kwargs):
            result = original(args, **kwargs)
            if args[:2] == ["docker", "build"]:
                self.updater.config["services"]["app"]["environment"]["HUB_MCP_TOKEN"] = "changed-fixture-token-" * 3
            return result

        with patch.object(self.updater, "run", side_effect=changing):
            with self.assertRaisesRegex(module.UpdateError, "settings changed"):
                self.updater.update()
        self.assertFalse(self.started())
        self.assertFalse(self.updater.pending.exists())

    def test_environment_mismatch_cannot_be_recovered_as_success(self):
        self.updater.fail = "health"
        with self.assertRaises(module.UpdateError):
            self.updater.update()
        self.updater.health = "healthy"
        self.updater.config["services"]["app"]["environment"]["HUB_MCP_TOKEN"] = "new-fixture-token-" * 3
        with self.assertRaisesRegex(module.UpdateError, "environment differs"):
            self.updater.update(recover=True)
        self.assertFalse(self.updater.latest.exists())
        self.assertTrue(self.updater.pending.exists())
        self.assertFalse(self.updater.status()["environmentMatches"])

    def test_preparation_failures_preserve_last_success(self):
        sentinel = {"imageId": OLD}
        module.atomic_json(self.updater.latest, sentinel)
        for stage in ("build", "pull", "exec", "cp"):
            with self.subTest(stage=stage):
                self.updater.fail = stage
                with self.assertRaises(module.UpdateError):
                    self.updater.update(registry_image=DIGEST if stage == "pull" else None)
                self.assertEqual(json.loads(self.updater.latest.read_text()), sentinel)
                self.assertFalse(self.updater.pending.exists())
                self.assertFalse(self.started())

    def test_start_failure_keeps_attempt_and_last_success(self):
        module.atomic_json(self.updater.latest, {"imageId": OLD})
        self.updater.fail = "start"
        with self.assertRaises(module.UpdateError):
            self.updater.update()
        self.assertTrue(self.updater.pending.exists())
        self.assertEqual(json.loads(self.updater.latest.read_text()), {"imageId": OLD})
        with self.assertRaisesRegex(module.UpdateError, "unfinished"):
            self.updater.update()

    def test_unhealthy_image_never_advances_success(self):
        self.updater.fail = "health"
        with self.assertRaisesRegex(module.UpdateError, "health check"):
            self.updater.update()
        self.assertFalse(self.updater.latest.exists())
        self.assertTrue(self.updater.pending.exists())

    def test_wrong_actual_image_never_advances_success(self):
        self.updater.fail = "identity"
        with self.assertRaisesRegex(module.UpdateError, "immutable image ID"):
            self.updater.update()
        self.assertFalse(self.updater.latest.exists())

    def test_recover_reverifies_a_healthy_interrupted_candidate(self):
        self.updater.fail = "health"
        with self.assertRaises(module.UpdateError):
            self.updater.update()
        self.updater.fail = None
        self.updater.health = "healthy"
        record = self.updater.update(recover=True)
        self.assertEqual(record["imageId"], NEW)
        self.assertFalse(self.updater.pending.exists())

    def test_explicit_rollback_uses_local_image_and_never_restores_database(self):
        self.updater.update()
        self.updater.calls.clear()
        record = self.updater.update(rollback=OLD)
        self.assertEqual(record["imageId"], OLD)
        self.assertEqual(record["operation"], "rollback")
        self.assertTrue(Path(record["backupPath"]).is_file())
        self.assertFalse(any("build" in a or "pull" in a for a in self.updater.calls))

    def test_stopped_failed_candidate_retains_preupdate_backup_for_rollback(self):
        self.updater.fail = "health"
        with self.assertRaises(module.UpdateError):
            self.updater.update()
        backup = json.loads(self.updater.pending.read_text())["backupPath"]
        self.updater.running = False
        self.updater.fail = None
        record = self.updater.update(rollback=OLD)
        self.assertEqual(record["backupPath"], backup)
        self.assertEqual(record["imageId"], OLD)

    def test_public_ports_and_volume_changes_are_rejected(self):
        self.updater.config["services"]["app"]["ports"][0]["host_ip"] = "0.0.0.0"
        with self.assertRaisesRegex(module.UpdateError, "loopback"):
            self.updater.update()
        self.updater.config["services"]["app"]["ports"][0]["host_ip"] = "127.0.0.1"
        self.updater.mount = "some-other-volume"
        with self.assertRaisesRegex(module.UpdateError, "storage"):
            self.updater.update()
        self.assertFalse(self.started())

    def test_missing_health_check_rejected_before_replacement(self):
        self.updater.candidate["Config"]["Healthcheck"] = {"Test": ["NONE"]}
        with self.assertRaisesRegex(module.UpdateError, "health check"):
            self.updater.update()
        self.assertFalse(self.started())

    def test_failed_latest_write_keeps_journal_and_previous_record(self):
        module.atomic_json(self.updater.latest, {"imageId": OLD})
        real_write = module.atomic_json
        def fail_latest(path, value):
            if path == self.updater.latest:
                raise OSError("disk full")
            real_write(path, value)
        with patch.object(module, "atomic_json", side_effect=fail_latest):
            with self.assertRaises(OSError):
                self.updater.update()
        self.assertEqual(json.loads(self.updater.latest.read_text()), {"imageId": OLD})
        self.assertTrue(self.updater.pending.exists())

    def test_atomic_replace_failure_leaves_old_record_intact(self):
        module.atomic_json(self.updater.latest, {"imageId": OLD})
        with patch.object(module.os, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                module.atomic_json(self.updater.latest, {"imageId": NEW})
        self.assertEqual(json.loads(self.updater.latest.read_text()), {"imageId": OLD})
        self.assertEqual(list(self.updater.state.glob(".record-*")), [])

    def test_status_compares_actual_and_last_success(self):
        module.atomic_json(self.updater.latest, {"imageId": NEW})
        status = self.updater.status()
        self.assertEqual(status["actualImageId"], OLD)
        self.assertEqual(status["latestSuccessful"]["imageId"], NEW)

    def test_existing_volume_without_container_cannot_bypass_backup(self):
        self.updater.current_id = None
        with self.assertRaisesRegex(module.UpdateError, "persisted data volume"):
            self.updater.update()
        self.assertFalse(self.started())

    def test_first_install_requires_absent_volume(self):
        self.updater.current_id = None
        self.updater.existing_volume = False
        record = self.updater.update()
        self.assertIsNone(record["backupPath"])
        self.assertIsNone(record["previousImageId"])

    def test_rollback_without_container_preserves_attempt_backup(self):
        self.updater.fail = "health"
        with self.assertRaises(module.UpdateError):
            self.updater.update()
        original = json.loads(self.updater.pending.read_text())
        self.updater.current_id = None
        self.updater.fail = None
        record = self.updater.update(rollback=OLD)
        self.assertEqual(record["backupPath"], original["backupPath"])
        self.assertEqual(record["supersededAttempt"]["imageId"], NEW)
        self.assertEqual(record["previousImageId"], OLD)

    def test_remote_engine_is_refused(self):
        with patch.dict(module.os.environ, {"DOCKER_HOST": "ssh://server"}):
            with self.assertRaisesRegex(module.UpdateError, "DOCKER_HOST"):
                self.updater.update()
        self.assertFalse(self.started())

    @unittest.skipUnless(module.os.name == "posix", "Linux flock test runs in Ubuntu CI")
    def test_concurrent_updates_are_rejected_and_lock_released(self):
        self.updater.state.chmod(0o700)
        with module.update_lock(self.updater.state, self.updater.state / "test.lock"):
            with self.assertRaisesRegex(module.UpdateError, "lock"):
                with module.update_lock(self.updater.state, self.updater.state / "test.lock"):
                    self.fail("Second lock unexpectedly acquired")
        with module.update_lock(self.updater.state, self.updater.state / "test.lock"):
            pass


@unittest.skipUnless(shutil.which("docker"), "Real Compose resolution requires the Docker CLI, not a running engine")
class ComposeEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copyfile(module.ROOT / "compose.yml", self.root / "compose.yml")

    def resolve(self, contents=None, shell=None):
        env_file = self.root / ".env"
        if contents is not None:
            env_file.write_text(contents, encoding="utf-8")
        environment = {key: value for key, value in os.environ.items() if not key.startswith("COMPOSE_") and key not in module.OPTIONAL_ENVIRONMENT}
        environment.update(shell or {})
        result = subprocess.run([
            "docker", "compose", "--project-directory", str(self.root), "--project-name", "zhixu",
            "--env-file", str(env_file) if env_file.exists() else os.devnull,
            "-f", str(self.root / "compose.yml"), "config", "--format", "json",
        ], env=environment, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=30)
        return json.loads(result.stdout)["services"]["app"]

    def test_unset_options_and_native_example_work_without_remote_configuration(self):
        for contents in (None, (module.ROOT / ".env.example").read_text(encoding="utf-8")):
            with self.subTest(has_file=contents is not None):
                app = self.resolve(contents)
                self.assertEqual({key: app["environment"][key] for key in module.FIXED_ENVIRONMENT}, module.FIXED_ENVIRONMENT)
                self.assertTrue(all(app["environment"].get(key) is None for key in module.OPTIONAL_ENVIRONMENT))
                self.assertEqual(app["ports"][0]["host_ip"], "127.0.0.1")

    def test_local_tokens_and_shell_precedence_preserve_literal_values(self):
        app = self.resolve(
            "GITHUB_TOKEN='fixture-$literal-token'\nHUB_MCP_TOKEN=fixture-from-file\n",
            {"HUB_MCP_TOKEN": "fixture-from-shell"},
        )
        self.assertEqual(module.resolved_environment(app)["GITHUB_TOKEN"], "fixture-$literal-token")
        self.assertEqual(app["environment"]["HUB_MCP_TOKEN"], "fixture-from-shell")

    def test_multiple_literal_dollars_are_preserved_for_runtime_comparison(self):
        app = self.resolve("GITHUB_TOKEN='fixture-$$literal-$token'\n")
        self.assertEqual(module.resolved_environment(app)["GITHUB_TOKEN"], "fixture-$$literal-$token")

    def test_oauth_settings_are_passed_and_other_variables_cannot_override_container(self):
        app = self.resolve(
            "HUB_PUBLIC_URL=https://zhixu.example\nHUB_SESSION_SECRET=" + "fixture-secret-" * 5 +
            "\nHUB_TRUST_PROXY=172.18.0.1,::1\nPORT=9999\nHUB_BIND_HOST=127.0.0.1\nHUB_DATA_DIR=./data\nNODE_OPTIONS=--inspect=0.0.0.0\n",
        )
        environment = app["environment"]
        self.assertEqual(environment["HUB_PUBLIC_URL"], "https://zhixu.example")
        self.assertEqual(environment["HUB_SESSION_SECRET"], "fixture-secret-" * 5)
        self.assertEqual(environment["HUB_TRUST_PROXY"], "172.18.0.1,::1")
        self.assertNotIn("NODE_OPTIONS", environment)
        self.assertEqual({key: environment[key] for key in module.FIXED_ENVIRONMENT}, module.FIXED_ENVIRONMENT)
        self.assertEqual(app["volumes"][0]["target"], "/app/data")


@unittest.skipUnless(os.environ.get("ZHIXU_TEST_IMAGE") and shutil.which("docker"), "Set ZHIXU_TEST_IMAGE to a local test image for isolated container creation")
class ComposeContainerEnvironmentTests(unittest.TestCase):
    def test_real_container_receives_file_values_and_preserves_fixed_settings(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project = "zhixu-env-test-" + uuid.uuid4().hex
            shutil.copyfile(module.ROOT / "compose.yml", root / "compose.yml")
            overlay = root / "image.json"
            overlay.write_text(json.dumps({"services": {"app": {"image": os.environ["ZHIXU_TEST_IMAGE"]}}}), encoding="utf-8")
            env_file = root / ".env"
            command = [
                "docker", "compose", "--project-directory", str(root), "--project-name", project,
                "--env-file", str(env_file), "-f", str(root / "compose.yml"), "-f", str(overlay),
            ]
            environment = {key: value for key, value in os.environ.items() if not key.startswith("COMPOSE_") and key not in module.OPTIONAL_ENVIRONMENT}

            def run(args):
                return subprocess.run(args, env=environment, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=90).stdout

            try:
                for settings in (
                    "GITHUB_TOKEN='fixture-$literal-$$token'\nHUB_MCP_TOKEN=" + "fixture-local-" * 4 + "\n",
                    "HUB_PUBLIC_URL=https://zhixu.example\nHUB_SESSION_SECRET=" + "fixture-secret-" * 5 + "\nHUB_TRUST_PROXY=172.18.0.1,::1\n",
                ):
                    env_file.write_text(settings + "PORT=9999\nHUB_BIND_HOST=127.0.0.1\nHUB_DATA_DIR=./data\nNODE_OPTIONS=--inspect\n", encoding="utf-8")
                    app = json.loads(run(command + ["config", "--format", "json"]))["services"]["app"]
                    run(command + ["create", "--no-build", "--pull", "never", "--force-recreate", "app"])
                    container_id = run(command + ["ps", "--all", "--quiet", "app"]).strip()
                    inspected = json.loads(run(["docker", "inspect", container_id]))[0]
                    actual = dict(value.split("=", 1) for value in inspected["Config"]["Env"] if "=" in value)
                    desired = module.resolved_environment(app)
                    for key in (*module.FIXED_ENVIRONMENT, *module.OPTIONAL_ENVIRONMENT):
                        self.assertEqual(actual.get(key), desired.get(key))
                    self.assertNotIn("NODE_OPTIONS", actual)
            finally:
                # Only this UUID-named test project's disposable resources are removed.
                run(command + ["down", "--volumes"])


if __name__ == "__main__":
    unittest.main()
