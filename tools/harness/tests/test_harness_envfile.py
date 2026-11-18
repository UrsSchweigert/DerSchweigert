import os

from harness import envfile


def test_loads_harness_keys_from_app_env_file(tmp_path, monkeypatch):
    monkeypatch.delenv("HARNESS_TEST_KEY", raising=False)
    monkeypatch.delenv("APP_SECRET_KEY", raising=False)
    env_file = tmp_path / "sites" / "derschweigert" / ".env"
    env_file.parent.mkdir(parents=True)
    env_file.write_text("APP_SECRET_KEY=do-not-import\nHARNESS_TEST_KEY=loaded\n")
    envfile.load_harness_env(tmp_path)
    assert os.environ["HARNESS_TEST_KEY"] == "loaded"
    assert "APP_SECRET_KEY" not in os.environ


def test_env_file_never_overrides_the_real_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("HARNESS_TEST_KEY", "real")
    env_file = tmp_path / "sites" / "derschweigert" / ".env"
    env_file.parent.mkdir(parents=True)
    env_file.write_text("HARNESS_TEST_KEY=from-file\n")
    envfile.load_harness_env(tmp_path)
    assert os.environ["HARNESS_TEST_KEY"] == "real"


def test_missing_env_file_is_not_an_error(tmp_path):
    envfile.load_harness_env(tmp_path)
