"""Isolated updater regression tests. Never contacts Docker, Git, or a VPS."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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
        self.config = {
            "services": {"app": {
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
                "Config": {"Labels": {"com.docker.compose.project": "zhixu", "com.docker.compose.service": "app"}},
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


if __name__ == "__main__":
    unittest.main()
