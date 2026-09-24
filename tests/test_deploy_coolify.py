"""Offline checks for the selective Coolify deployment boundary."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "deploy-coolify.py"
spec = importlib.util.spec_from_file_location("deploy_coolify", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

IMAGE = "127.0.0.1:5000/migration/botclo-web:" + "a" * 40
IMAGE_ID = "sha256:" + "b" * 64
SERVICE = "service123"
WEB = "web456"


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.token = Path(self.directory.name) / "token"
        self.token.write_text("private-token\n")
        self.token.chmod(0o600)
        self.config = Path(self.directory.name) / "config.json"
        self.config.write_text(json.dumps({
            "api_url": "http://127.0.0.1:8000/api/v1",
            "service_uuid": SERVICE,
            "token_file": str(self.token),
        }))
        self.calls = []

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if method == "GET":
            return {"uuid": SERVICE, "applications": [{"name": "web", "uuid": WEB}]}
        return {"message": "accepted"}

    def deploy(self, request=None, containers=None):
        with patch.object(module.CoolifyClient, "request", side_effect=request or self.request), \
             patch.object(module, "image_id", return_value=IMAGE_ID), \
             patch.object(module, "project_containers", side_effect=containers or [
                 {"web": "old-web", "db": "database", "bot": "scheduler"},
                 {"web": "new-web", "db": "database", "bot": "scheduler"},
             ]), \
             patch.object(module, "container_ready", return_value=True):
            return module.deploy(self.config, IMAGE, timeout=0)

    def test_changes_only_image_and_starts_only_web(self):
        result = self.deploy()
        self.assertEqual(self.calls, [
            ("GET", f"/services/{SERVICE}", None),
            ("PATCH", f"/services/{SERVICE}/envs/bulk", {"data": [{
                "key": "BOTCLO_WEB_IMAGE", "value": IMAGE,
                "is_literal": True, "is_multiline": False,
            }]}),
            ("POST", f"/services/{SERVICE}/applications/{WEB}/start?latest=false&force=false", None),
        ])
        self.assertEqual(result["container_id"], "new-web")
        self.assertTrue(result["other_container_ids_unchanged"])

    def test_http_error_before_mutation_prevents_all_writes(self):
        def unavailable(method, path, payload=None):
            self.calls.append((method, path, payload))
            raise module.DeploymentError("Coolify request failed (HTTP 503).")
        with self.assertRaises(module.DeploymentError):
            self.deploy(request=unavailable)
        self.assertEqual([call[0] for call in self.calls], ["GET"])

    def test_failed_patch_does_not_start_web(self):
        def fail_patch(method, path, payload=None):
            if method == "PATCH":
                self.calls.append((method, path, payload))
                raise module.DeploymentError("Coolify request failed (HTTP 422).")
            return self.request(method, path, payload)
        with self.assertRaises(module.DeploymentError):
            self.deploy(request=fail_patch)
        self.assertEqual([call[0] for call in self.calls], ["GET", "PATCH"])

    def test_empty_token_stops_before_api_or_docker(self):
        self.token.write_text(" \n")
        with patch.object(module.CoolifyClient, "request") as request, \
             patch.object(module, "image_id") as inspect:
            with self.assertRaises(module.DeploymentError):
                module.deploy(self.config, IMAGE, timeout=0)
        request.assert_not_called()
        inspect.assert_not_called()

    def test_http_error_redacts_response_body_and_authorization(self):
        client = module.CoolifyClient(self.config)
        error = HTTPError("http://127.0.0.1:8000/api/v1/services", 403,
                          "private-token", {}, io.BytesIO(b"private-response-body"))
        with patch.object(client.opener, "open", side_effect=error):
            with self.assertRaisesRegex(module.DeploymentError, r"HTTP 403") as raised:
                client.request("GET", "/services")
        self.assertNotIn("private-token", str(raised.exception))
        self.assertNotIn("private-response-body", str(raised.exception))
        error.close()

    def test_redirects_cannot_forward_authorization(self):
        handler = module.NoRedirects()
        self.assertIsNone(handler.redirect_request(None, None, 302, "redirect", {},
                                                  "https://other.example"))

    def test_remote_plain_http_stops_before_api(self):
        data = json.loads(self.config.read_text())
        data["api_url"] = "http://example.com/api/v1"
        self.config.write_text(json.dumps(data))
        with patch.object(module.CoolifyClient, "request") as request:
            with self.assertRaises(module.DeploymentError):
                module.deploy(self.config, IMAGE, timeout=0)
        request.assert_not_called()

    def test_ambiguous_web_stops_before_mutation(self):
        def ambiguous(method, path, payload=None):
            self.calls.append((method, path, payload))
            return {"uuid": SERVICE, "applications": [
                {"name": "web", "uuid": WEB}, {"name": "web", "uuid": "other"},
            ]}
        with self.assertRaises(module.DeploymentError):
            self.deploy(request=ambiguous)
        self.assertEqual([call[0] for call in self.calls], ["GET"])

    def test_changed_database_container_is_failure(self):
        with self.assertRaises(module.DeploymentError):
            self.deploy(containers=[
                {"web": "old-web", "db": "database", "bot": "scheduler"},
                {"web": "new-web", "db": "replacement", "bot": "scheduler"},
            ])

    def test_unverified_running_image_is_failure(self):
        with patch.object(module.CoolifyClient, "request", side_effect=self.request), \
             patch.object(module, "image_id", return_value=IMAGE_ID), \
             patch.object(module, "project_containers", return_value={"web": "old-web", "db": "database"}), \
             patch.object(module, "container_ready", return_value=False):
            with self.assertRaises(module.DeploymentError):
                module.deploy(self.config, IMAGE, timeout=0)

    def test_latest_or_other_registry_image_rejected(self):
        for invalid in ["127.0.0.1:5000/migration/botclo-web:latest", "other.example/web:" + "a" * 40]:
            with self.subTest(image=invalid), patch.object(module.CoolifyClient, "request") as request:
                with self.assertRaises(module.DeploymentError):
                    module.deploy(self.config, invalid, timeout=0)
                request.assert_not_called()

    def test_container_verification_requires_exact_image_and_health(self):
        with patch.object(module, "docker", return_value=f"true\nhealthy\n{IMAGE_ID}\n{IMAGE}\n"):
            self.assertTrue(module.container_ready("web-id", IMAGE, IMAGE_ID))
        for output in [f"false\nhealthy\n{IMAGE_ID}\n{IMAGE}\n", f"true\nunhealthy\n{IMAGE_ID}\n{IMAGE}\n", f"true\n\nsha256:wrong\n{IMAGE}\n", f"true\nhealthy\n{IMAGE_ID}\nother\n"]:
            with self.subTest(output=output), patch.object(module, "docker", return_value=output):
                self.assertFalse(module.container_ready("web-id", IMAGE, IMAGE_ID))

    def test_container_recreated_between_listing_and_inspection_is_not_ready(self):
        with patch.object(module, "docker", side_effect=module.DeploymentError("Container missing.")):
            self.assertFalse(module.container_ready("old-web", IMAGE, IMAGE_ID))


if __name__ == "__main__":
    unittest.main()
