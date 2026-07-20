# Portable Python runtime (optional)

Drop a **fixed** Windows embeddable / standalone Python here so Nuitka `.pyd` gateway modules match customer machines:

```
resources/python-runtime/python.exe
resources/python-runtime/…
```

`resolvePythonExe()` prefers this path when packaged (`process.resourcesPath/python-runtime/python.exe`).

## Pack

`electron-builder` ships this folder when present (`extraResources` → `python-runtime`).

## Build Nuitka against the same major version

```powershell
# Example: embed Python 3.14, then
$env:AINOVEL_PYTHON_EXE = "D:\path\to\python-runtime\python.exe"
npm run compile:python-gateway
```

If this folder is empty / missing, app falls back to system Python (seal `.py.seal` still works multi-version).
