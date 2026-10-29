"""BYOK provider profiles: the store file, the environment they produce, and the source they enable."""
import json
import os
import stat

import pytest

from harness import isolation, models, providers
from harness.adapter import CopilotCliAdapter


def test_a_source_without_a_profile_produces_no_environment(tmp_path):
    assert providers.env_for(str(tmp_path), "deepseek", "deepseek/deepseek-flash") is None


def test_env_for_builds_the_names_the_cli_documents(tmp_path):
    providers.save(str(tmp_path), "deepseek", api_key="sk-test-1234")
    env = providers.env_for(str(tmp_path), "deepseek", "deepseek/deepseek-flash")
    assert env == {
        providers.ENV_BASE_URL: "https://api.deepseek.com",
        providers.ENV_TYPE: "openai",
        providers.ENV_API_KEY: "sk-test-1234",
        providers.ENV_WIRE_MODEL: "deepseek-flash",
        providers.ENV_MODEL: "deepseek-flash",
    }


def test_the_source_prefix_is_not_sent_as_the_wire_model():
    assert providers.wire_model("deepseek/deepseek-v4-pro") == "deepseek-v4-pro"
    assert providers.wire_model("deepseek-flash") == "deepseek-flash"


def test_saving_writes_an_owner_only_file_and_keeps_other_sources(tmp_path):
    providers.save(str(tmp_path), "deepseek", api_key="sk-deep")
    providers.save(str(tmp_path), "local", api_key="sk-local", base_url="http://127.0.0.1:11434/v1")
    path = providers.path(str(tmp_path))
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    loaded = providers.load(str(tmp_path))
    assert set(loaded) == {"deepseek", "local"}
    assert loaded["local"]["baseUrl"] == "http://127.0.0.1:11434/v1"


@pytest.mark.parametrize("kwargs, message", [
    ({"api_key": "  "}, "API key"),
    ({"api_key": "sk-x", "base_url": "not-a-url"}, "http"),
])
def test_invalid_profiles_are_refused(tmp_path, kwargs, message):
    with pytest.raises(ValueError, match=message):
        providers.save(str(tmp_path), "deepseek", **kwargs)


def test_an_unknown_source_needs_an_explicit_base_url(tmp_path):
    with pytest.raises(ValueError, match="base URL"):
        providers.save(str(tmp_path), "local", api_key="sk-x")


def test_a_malformed_or_keyless_file_yields_no_profiles(tmp_path):
    (tmp_path / providers.FILE).write_text('{"deepseek": {"baseUrl": "https://x"}}')
    assert providers.load(str(tmp_path)) == {}
    (tmp_path / providers.FILE).write_text("not json")
    assert providers.load(str(tmp_path)) == {}


def test_redacted_output_never_reveals_the_key(tmp_path):
    providers.save(str(tmp_path), "deepseek", api_key="placeholder-key-abcdefghijkl")
    shown = json.dumps(providers.redacted(str(tmp_path)))
    assert "abcdefghijkl" not in shown
    assert shown.count("*") > 0


def test_source_for_inverts_the_catalog():
    catalog = models.load_catalog(None)
    assert models.source_for("deepseek/deepseek-v4-pro", catalog) == "deepseek"
    assert models.source_for("claude-sonnet-5", catalog) == "copilot"
    assert models.source_for("ollama-models/gemma4:12b", catalog) == "local"
    assert models.source_for("nope", catalog) is None


def test_catalog_ids_are_real_wire_names_for_deepseek():
    catalog = models.load_catalog(None)
    for ids in catalog["deepseek"].values():
        for model in ids:
            assert providers.wire_model(model).startswith("deepseek")


def test_the_worker_forwards_only_the_credential_the_attempt_needs():
    provider = {"COPILOT_PROVIDER_BASE_URL": "https://api.deepseek.com"}
    assert isolation.pass_env_names(None, provider) == list(provider)
    assert isolation.pass_env_names("/tmp/copilot.token", None) == [isolation.COPILOT_TOKEN_ENV]
    both = isolation.pass_env_names("/tmp/copilot.token", provider)
    assert isolation.COPILOT_TOKEN_ENV in both and list(provider)[0] in both


def test_a_byok_attempt_needs_no_copilot_token(tmp_path):
    providers.save(str(tmp_path), "deepseek", api_key="sk-test")
    adapter = CopilotCliAdapter(str(tmp_path), str(tmp_path))
    token_file, problem = adapter._credential(["deepseek/deepseek-flash"])
    assert problem == "" and token_file is None


def test_a_copilot_candidate_without_a_token_is_reported(tmp_path):
    adapter = CopilotCliAdapter(str(tmp_path), str(tmp_path))
    token_file, problem = adapter._credential(["claude-sonnet-5"])
    assert token_file is None and "copilot.token" in problem


def test_the_probe_reports_a_byok_failure_as_not_accepted(monkeypatch, tmp_path):
    providers.save(str(tmp_path), "deepseek", api_key="sk-test")
    monkeypatch.setattr(isolation, "docker_available", lambda: True)
    monkeypatch.setattr(isolation, "image_id", lambda image=None: "sha256:test")
    monkeypatch.setattr(isolation, "new_workdir", lambda prefix: str(tmp_path))
    import shutil

    monkeypatch.setattr(shutil, "rmtree", lambda *a, **k: None)
    calls = []

    def fake_run(workdir, command, token_file=None, timeout=1800, provider=None):
        calls.append((token_file, provider))

        class Result:
            returncode = 1
            stdout = "error: invalid api key"
            stderr = ""

        return Result()

    monkeypatch.setattr(isolation, "run_worker", fake_run)
    result = CopilotCliAdapter(str(tmp_path), str(tmp_path)).probe(["deepseek/deepseek-flash"])
    assert result["models"] == []
    token_file, provider = calls[0]
    assert token_file is None and provider[providers.ENV_API_KEY] == "sk-test"
