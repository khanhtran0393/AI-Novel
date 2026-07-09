from pathlib import Path

p = Path(
    r"D:\SuperAudioTools\omnivoice-python\Lib\site-packages\omnivoice_server\config.py"
)
t = p.read_text(encoding="utf-8")
if 'extra="ignore"' in t or "extra='ignore'" in t:
    print("ALREADY_PATCHED")
    raise SystemExit(0)

old = """model_config = SettingsConfigDict(
        env_prefix="OMNIVOICE_",
        env_file=".env",
        env_file_encoding="utf-8",
    )"""
new = """model_config = SettingsConfigDict(
        env_prefix="OMNIVOICE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )"""
if old not in t:
    raise SystemExit("PATTERN_MISSING")
p.write_text(t.replace(old, new), encoding="utf-8")
print("PATCHED_OK")
