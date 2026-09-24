#!/usr/bin/env python3
"""Deploy a verified local image through Coolify without restarting dependencies."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class DeploymentError(Exception):
    """A safe diagnostic that contains no API response or credentials."""


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class CoolifyClient:
    def __init__(self, config_path):
        try:
            config = json.loads(Path(config_path).read_text())
            self.api_url = config["api_url"].rstrip("/")
            self.service_uuid = config["service_uuid"]
            token_file = Path(config["token_file"])
            if self.api_url != "http://127.0.0.1:8000/api/v1":
                raise DeploymentError("Coolify API must use the local loopback endpoint.")
            if not valid_identifier(self.service_uuid):
                raise DeploymentError("Invalid Coolify service identifier.")
            if token_file.stat().st_mode & 0o077:
                raise DeploymentError("Coolify token file must be readable only by its owner.")
            self.token = token_file.read_text().strip()
            if not self.token or any(character.isspace() for character in self.token):
                raise DeploymentError("Coolify token is empty or invalid.")
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            raise DeploymentError("Cannot read a valid private Coolify configuration.") from None
        # Loopback calls must not inherit an outbound HTTP proxy or follow redirects.
        self.opener = build_opener(ProxyHandler({}), NoRedirects())

    def request(self, method, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        request = Request(self.api_url + path, data=data, method=method, headers={
            "Authorization": "Bearer " + self.token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        try:
            with self.opener.open(request, timeout=30) as response:
                if not 200 <= response.status < 300:
                    raise DeploymentError("Coolify returned an unsuccessful HTTP status.")
                body = response.read(2_000_001)
                if len(body) > 2_000_000:
                    raise DeploymentError("Coolify response exceeds the expected size.")
                return json.loads(body) if body else {}
        except HTTPError as error:
            raise DeploymentError(f"Coolify request failed (HTTP {error.code}).") from None
        except (URLError, TimeoutError, OSError):
            raise DeploymentError("Coolify request failed before a successful response.") from None
        except (ValueError, UnicodeError):
            raise DeploymentError("Coolify returned an invalid JSON response.") from None


def valid_identifier(value):
    return isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", value) is not None


def docker(*arguments):
    try:
        result = subprocess.run(["docker", *arguments], capture_output=True, text=True,
                                timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise DeploymentError("Docker verification could not complete.") from None
    if result.returncode:
        raise DeploymentError("Docker verification failed; inspect the local container state.")
    return result.stdout


def image_id(image):
    identity = docker("image", "inspect", "--format", "{{.Id}}", image).strip()
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", identity):
        raise DeploymentError("The release image is not available locally.")
    return identity


def project_containers(service_uuid, replacing_service=None):
    output = docker("ps", "-a", "--no-trunc", "--filter",
                    "label=com.docker.compose.project=" + service_uuid,
                    "--format", '{{.ID}}\t{{.Label "com.docker.compose.service"}}')
    containers = {}
    overlapping = set()
    for line in output.splitlines():
        parts = line.split("\t")
        if len(parts) != 2 or not parts[1]:
            raise DeploymentError("The Coolify project contains ambiguous service containers.")
        if parts[1] in containers:
            if parts[1] != replacing_service or replacing_service != "web":
                raise DeploymentError("The Coolify project contains ambiguous service containers.")
            overlapping.add(parts[1])
        containers[parts[1]] = parts[0]
    # Compose can briefly list both old and new web containers. Keep checking
    # every dependency, but do not verify web until its identity is unambiguous.
    return {service: identity for service, identity in containers.items()
            if service not in overlapping}


def container_ready(container, image, expected_id):
    try:
        output = docker("inspect", "--format",
                        "{{.State.Running}}\n{{if .State.Health}}{{.State.Health.Status}}{{end}}\n{{.Image}}\n{{.Config.Image}}",
                        container).splitlines()
    except DeploymentError:
        # Coolify may remove the listed container before this inspection.
        return False
    return (len(output) == 4 and output[0] == "true" and
            output[1] in ("", "healthy") and output[2] == expected_id and output[3] == image)


def deploy(config_path, image, timeout=300):
    if not re.fullmatch(r"127\.0\.0\.1:5000/migration/botclo-web:[a-f0-9]{40}", image):
        raise DeploymentError("Expected the local Botclo image tagged with a full Git commit SHA.")
    client = CoolifyClient(config_path)
    expected_id = image_id(image)
    path = "/services/" + client.service_uuid
    service = client.request("GET", path)
    if not isinstance(service, dict) or service.get("uuid") != client.service_uuid:
        raise DeploymentError("Coolify returned a different service than configured.")
    applications = service.get("applications", [])
    if not isinstance(applications, list):
        raise DeploymentError("Coolify returned an invalid application list.")
    web = [item for item in applications if isinstance(item, dict) and item.get("name") == "web"]
    if len(web) != 1 or not valid_identifier(web[0].get("uuid")):
        raise DeploymentError("The configured Coolify service must contain exactly one web application.")
    previous = project_containers(client.service_uuid)
    if "web" not in previous or "db" not in previous:
        raise DeploymentError("The existing web and database containers could not be verified.")
    dependencies = {key: value for key, value in previous.items() if key != "web"}
    client.request("PATCH", path + "/envs/bulk", {"data": [{
        "key": "BOTCLO_WEB_IMAGE", "value": image,
        "is_literal": True, "is_multiline": False,
    }]})
    client.request("POST", path + "/applications/" + web[0]["uuid"] +
                   "/start?latest=false&force=false")
    deadline = time.monotonic() + timeout
    while True:
        current = project_containers(client.service_uuid, replacing_service="web")
        if {key: value for key, value in current.items() if key != "web"} != dependencies:
            raise DeploymentError("A dependency container changed during the selective web deployment.")
        container = current.get("web")
        if container and container_ready(container, image, expected_id):
            return {"service": "web", "image": image, "container_id": container,
                    "other_container_ids_unchanged": True}
        if time.monotonic() >= deadline:
            raise DeploymentError("Timed out waiting for the requested web image to be running and healthy.")
        time.sleep(3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image")
    parser.add_argument("--config", default="/data/migration/botclo-deploy.json")
    args = parser.parse_args()
    try:
        print(json.dumps(deploy(args.config, args.image)))
    except DeploymentError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
