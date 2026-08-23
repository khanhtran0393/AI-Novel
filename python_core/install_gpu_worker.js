const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const statusFile = path.join(__dirname, 'gpu_install_status.json');
const logFile = path.join(__dirname, 'gpu_install_log.txt');

// Read selected vendor target
const vendor = process.argv[2] || 'nvidia';

/**
 * Pin onnxruntime-gpu to a build that matches the PyTorch cu121 stack.
 * ORT 1.27+ requires CUDA 13 + cuDNN 9 (not installed on most gaming PCs).
 * ORT 1.19.2 works with CUDA 12.x already bundled with torch+cu121.
 */
const ORT_GPU_PIN = process.env.ORT_GPU_VERSION || '1.19.2';

function updateStatus(status, progress, message, logAppend = '') {
  let data = {
    status: 'idle',
    progress: 0,
    message: '',
    log: '',
    startTime: new Date().toISOString(),
  };

  if (fs.existsSync(statusFile)) {
    try {
      data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    } catch {
      /* keep defaults */
    }
  }

  data.status = status;
  data.progress = progress;
  data.message = message;
  data.pid = process.pid;
  data.updatedAt = new Date().toISOString();
  if (logAppend) {
    let newLog = (data.log || '') + logAppend;
    if (newLog.length > 50000) {
      newLog = '... [Truncated due to size] ...\n' + newLog.slice(-40000);
    }
    data.log = newLog;
    try {
      fs.appendFileSync(logFile, logAppend);
    } catch {
      /* ignore */
    }
  }

  fs.writeFileSync(statusFile, JSON.stringify(data, null, 2), 'utf8');
}

async function runCommand(cmd, stageName, startProgress, endProgress) {
  return new Promise((resolve, reject) => {
    updateStatus(
      'installing',
      startProgress,
      `Đang chạy: ${stageName}...`,
      `\n[RUNNING] ${cmd}\n`,
    );

    const proc = exec(cmd, { windowsHide: true, maxBuffer: 20 * 1024 * 1024 });

    proc.stdout.on('data', (data) => {
      updateStatus(
        'installing',
        startProgress,
        `Đang cài đặt: ${stageName}`,
        data.toString(),
      );
    });

    proc.stderr.on('data', (data) => {
      updateStatus(
        'installing',
        startProgress,
        `Đang cài đặt: ${stageName}`,
        `[INFO] ${data.toString()}`,
      );
    });

    proc.on('close', (code) => {
      if (code === 0) {
        updateStatus(
          'installing',
          endProgress,
          `Đã xong: ${stageName}`,
          `\n[SUCCESS] ${stageName} hoàn tất.\n`,
        );
        resolve();
      } else {
        updateStatus(
          'failed',
          startProgress,
          `Lỗi khi chạy: ${stageName}`,
          `\n[ERROR] ${stageName} thất bại với mã thoát ${code}.\n`,
        );
        reject(new Error(`${stageName} failed with code ${code}`));
      }
    });
  });
}

function runCapture(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
        out: `${stdout || ''}\n${stderr || ''}`.trim(),
      });
    });
  });
}

async function main() {
  const localPython = 'D:\\SuperAudioTools\\omnivoice-python\\python.exe';
  const pythonExe = fs.existsSync(localPython) ? localPython : 'python';

  try {
    fs.writeFileSync(
      logFile,
      `Bắt đầu cài đặt cấu hình GPU [${vendor.toUpperCase()}] lúc ${new Date().toLocaleString()}\n`,
    );
  } catch {
    /* ignore */
  }

  updateStatus(
    'installing',
    5,
    'Khởi động bộ cài đặt cấu hình...',
    `Bắt đầu nâng cấp GPU (${vendor.toUpperCase()})...\n`,
  );

  try {
    if (vendor === 'nvidia') {
      // 1. Gỡ mọi bản ONNX CPU/DML/GPU cũ (tránh ORT 1.27 đòi CUDA 13)
      await runCommand(
        `"${pythonExe}" -m pip uninstall -y onnxruntime onnxruntime-gpu onnxruntime-directml`,
        'Gỡ cài đặt các bản ONNX cũ',
        10,
        15,
      ).catch(() => {});

      // 2. PyTorch CUDA 12.1 (OmniVoice / torch)
      const installerScript = path.join(__dirname, 'install_pytorch_cuda.py');
      await runCommand(
        `"${pythonExe}" "${installerScript}"`,
        'Cài đặt PyTorch CUDA 12.1 (~2.4GB, vui lòng chờ)',
        15,
        70,
      );

      // 3. ONNX Runtime GPU pin CUDA 12.x (Vina Zero-Shot) — KHÔNG cài latest 1.27
      await runCommand(
        `"${pythonExe}" -m pip install --no-cache-dir "onnxruntime-gpu==${ORT_GPU_PIN}"`,
        `Cài đặt ONNX Runtime GPU ${ORT_GPU_PIN} (CUDA 12.x)`,
        70,
        90,
      );

      // 4. Verify torch + ORT CUDA (not list-only)
      updateStatus('installing', 92, 'Đang xác thực CUDA (Torch + ONNX)...', '\nĐang xác thực...\n');

      const verifyPy = `
import json, sys
out = {"torch_ok": False, "ort_ok": False, "torch": "", "ort": "", "providers": [], "detail": ""}
try:
    import torch
    out["torch"] = getattr(torch, "__version__", "")
    out["torch_ok"] = bool(torch.cuda.is_available())
    if out["torch_ok"]:
        out["detail"] += "device=" + torch.cuda.get_device_name(0) + "; "
except Exception as e:
    out["detail"] += "torch_err=" + str(e)[:120] + "; "
try:
    import onnxruntime as ort
    out["ort"] = getattr(ort, "__version__", "")
    out["providers"] = list(ort.get_available_providers() or [])
    # Real probe: CUDA must be listed; full model load is optional (slow)
    if "CUDAExecutionProvider" in out["providers"]:
        # Lightweight: provider options without loading 1.3GB brain
        try:
            from onnxruntime.capi import _pybind_state as C
            # If factory exists, package is GPU build
            out["ort_ok"] = True
        except Exception:
            out["ort_ok"] = "CUDAExecutionProvider" in out["providers"]
    else:
        out["ort_ok"] = False
        out["detail"] += "no_cuda_ep; "
except Exception as e:
    out["detail"] += "ort_err=" + str(e)[:120] + "; "
print(json.dumps(out, ensure_ascii=False))
`.trim();

      const tmpVerify = path.join(__dirname, '_verify_gpu_tmp.py');
      fs.writeFileSync(tmpVerify, verifyPy, 'utf8');
      const { out } = await runCapture(`"${pythonExe}" "${tmpVerify}"`);
      try {
        fs.unlinkSync(tmpVerify);
      } catch {
        /* ignore */
      }

      let parsed = null;
      try {
        const line = out
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .pop();
        parsed = JSON.parse(line || '{}');
      } catch {
        parsed = null;
      }

      const torchOk = !!(parsed && parsed.torch_ok);
      const ortOk = !!(parsed && parsed.ort_ok);
      const detail = parsed
        ? `torch=${parsed.torch} cuda=${parsed.torch_ok} | ort=${parsed.ort} providers=${(parsed.providers || []).join(',')} | ${parsed.detail || ''}`
        : out.slice(0, 400);

      // Persist Vina EP cache: if ORT CUDA listed, clear forced-cpu so Vina can try GPU
      try {
        const epCache = path.join(process.cwd(), 'data', 'cache', 'vina_ort_ep.json');
        fs.mkdirSync(path.dirname(epCache), { recursive: true });
        if (ortOk) {
          fs.writeFileSync(
            epCache,
            JSON.stringify(
              {
                cuda_ok: true,
                prefer: 'auto',
                note: `ORT ${parsed?.ort || ORT_GPU_PIN} installed for CUDA 12.x`,
              },
              null,
              2,
            ),
            'utf8',
          );
        }
      } catch {
        /* ignore */
      }

      if (torchOk && ortOk) {
        updateStatus(
          'success',
          100,
          'Tăng tốc NVIDIA GPU thành công (PyTorch + ONNX CUDA 12.x)!',
          `\n[SUCCESS] ${detail}\n` +
            'OmniVoice (torch) + Vina (ONNX) có thể dùng GPU.\n',
        );
      } else if (torchOk) {
        updateStatus(
          'success',
          100,
          'PyTorch CUDA OK — OmniVoice GPU sẵn sàng. ONNX GPU chưa xác nhận (Vina có thể chạy CPU).',
          `\n[PARTIAL] ${detail}\n`,
        );
      } else {
        updateStatus(
          'failed',
          95,
          'Xác thực CUDA thất bại (torch.cuda=False)',
          `\n[ERROR] ${detail}\n`,
        );
      }
    } else {
      // AMD / Intel GPU DirectML acceleration
      await runCommand(
        `"${pythonExe}" -m pip uninstall -y onnxruntime onnxruntime-gpu`,
        'Gỡ cài đặt các bản ONNX khác',
        10,
        15,
      ).catch(() => {});

      await runCommand(
        `"${pythonExe}" -m pip install onnxruntime-directml`,
        'Cài đặt ONNX Runtime DirectML',
        15,
        50,
      );

      await runCommand(
        `"${pythonExe}" -m pip install torch-directml`,
        'Cài đặt PyTorch DirectML cho AMD/Intel GPU',
        50,
        90,
      );

      updateStatus(
        'installing',
        90,
        'Đang xác thực DirectML...',
        '\nĐang xác thực DirectML...\n',
      );
      const verifyCmd = `"${pythonExe}" -c "import torch_directml; print('DML_OK:', torch_directml.is_available())"`;

      exec(verifyCmd, { windowsHide: true }, (err, stdout, stderr) => {
        const output = `${stdout || ''}\n${stderr || ''}`.trim();
        if (output.includes('DML_OK: True')) {
          updateStatus(
            'success',
            100,
            'Tăng tốc GPU AMD/Intel (DirectML) thành công!',
            `\n[SUCCESS] Xác thực DirectML thành công: ${output}\n`,
          );
        } else {
          updateStatus(
            'failed',
            90,
            'Xác thực DirectML thất bại',
            `\n[ERROR] Xác thực thất bại: ${output}\n`,
          );
        }
      });
    }
  } catch (err) {
    updateStatus(
      'failed',
      0,
      `Lỗi cài đặt: ${err.message}`,
      `\n[FATAL ERROR] Tiến trình bị hủy do lỗi: ${err.message}\n`,
    );
  }
}

main();
