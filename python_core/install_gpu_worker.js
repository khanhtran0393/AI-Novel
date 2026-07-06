const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const statusFile = path.join(__dirname, 'gpu_install_status.json');
const logFile = path.join(__dirname, 'gpu_install_log.txt');

// Read selected vendor target
const vendor = process.argv[2] || 'nvidia';

function updateStatus(status, progress, message, logAppend = '') {
  let data = {
    status: 'idle',
    progress: 0,
    message: '',
    log: '',
    startTime: new Date().toISOString()
  };
  
  if (fs.existsSync(statusFile)) {
    try {
      data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    } catch {}
  }
  
  data.status = status;
  data.progress = progress;
  data.message = message;
  if (logAppend) {
    let newLog = (data.log || '') + logAppend;
    if (newLog.length > 50000) {
      newLog = '... [Truncated due to size] ...\n' + newLog.slice(-40000);
    }
    data.log = newLog;
    fs.appendFileSync(logFile, logAppend);
  }
  
  fs.writeFileSync(statusFile, JSON.stringify(data, null, 2), 'utf8');
}

async function runCommand(cmd, stageName, startProgress, endProgress) {
  return new Promise((resolve, reject) => {
    updateStatus('installing', startProgress, `Đang chạy: ${stageName}...`, `\n[RUNNING] ${cmd}\n`);
    
    const proc = exec(cmd, { windowsHide: true });
    
    proc.stdout.on('data', (data) => {
      updateStatus('installing', startProgress, `Đang cài đặt: ${stageName}`, data.toString());
    });
    
    proc.stderr.on('data', (data) => {
      updateStatus('installing', startProgress, `Đang cài đặt: ${stageName}`, `[INFO] ${data.toString()}`);
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        updateStatus('installing', endProgress, `Đã xong: ${stageName}`, `\n[SUCCESS] ${stageName} hoàn tất.\n`);
        resolve();
      } else {
        updateStatus('failed', startProgress, `Lỗi khi chạy: ${stageName}`, `\n[ERROR] ${stageName} thất bại với mã thoát ${code}.\n`);
        reject(new Error(`${stageName} failed with code ${code}`));
      }
    });
  });
}

async function main() {
  const localPython = 'D:\\SuperAudioTools\\omnivoice-python\\python.exe';
  const pythonExe = fs.existsSync(localPython) ? localPython : 'python';
  
  try {
    fs.writeFileSync(logFile, `Bắt đầu cài đặt cấu hình GPU [${vendor.toUpperCase()}] lúc ${new Date().toLocaleString()}\n`);
  } catch {}
  
  updateStatus('installing', 5, 'Khởi động bộ cài đặt cấu hình...', `Bắt đầu nâng cấp GPU (${vendor.toUpperCase()})...\n`);
  
  try {
    if (vendor === 'nvidia') {
      // 1. Gỡ cài đặt onnxruntime thường
      await runCommand(`"${pythonExe}" -m pip uninstall -y onnxruntime onnxruntime-directml`, 'Gỡ cài đặt các bản ONNX khác', 10, 15)
        .catch(() => {});
        
      // 2. Cài đặt PyTorch CUDA via custom download script (bypassing pip SSL issues)
      const installerScript = path.join(__dirname, 'install_pytorch_cuda.py');
      await runCommand(`"${pythonExe}" "${installerScript}"`, 'Cài đặt PyTorch CUDA 12.1 (~2.4GB, vui lòng chờ)', 15, 80);
      
      // 3. Cài đặt ONNX Runtime GPU
      await runCommand(`"${pythonExe}" -m pip install onnxruntime-gpu`, 'Cài đặt ONNX Runtime GPU', 80, 95);
      
      // 4. Kiểm tra CUDA
      updateStatus('installing', 95, 'Đang xác thực CUDA...', '\nĐang xác thực CUDA...\n');
      const verifyCmd = `"${pythonExe}" -c "import torch; print('CUDA_OK:', torch.cuda.is_available())"`;
      
      exec(verifyCmd, { windowsHide: true }, (err, stdout, stderr) => {
        const output = stdout.trim() + '\n' + stderr.trim();
        if (output.includes('CUDA_OK: True')) {
          updateStatus('success', 100, 'Tăng tốc NVIDIA GPU (CUDA) thành công!', `\n[SUCCESS] Xác thực CUDA thành công: ${output}\n`);
        } else {
          updateStatus('failed', 95, 'Xác thực CUDA thất bại (CUDA chưa hoạt động)', `\n[ERROR] Xác thực thất bại: ${output}\n`);
        }
      });
    } else {
      // AMD / Intel GPU DirectML acceleration
      // 1. Gỡ cài đặt onnxruntime thường & GPU
      await runCommand(`"${pythonExe}" -m pip uninstall -y onnxruntime onnxruntime-gpu`, 'Gỡ cài đặt các bản ONNX khác', 10, 15)
        .catch(() => {});
        
      // 2. Cài đặt ONNX Runtime DirectML (Dành cho GPU AMD/Intel trên Windows)
      await runCommand(`"${pythonExe}" -m pip install onnxruntime-directml`, 'Cài đặt ONNX Runtime DirectML', 15, 50);
      
      // 3. Cài đặt PyTorch DirectML
      await runCommand(`"${pythonExe}" -m pip install torch-directml`, 'Cài đặt PyTorch DirectML cho AMD/Intel GPU', 50, 90);
      
      // 4. Kiểm tra DirectML
      updateStatus('installing', 90, 'Đang xác thực DirectML...', '\nĐang xác thực DirectML...\n');
      const verifyCmd = `"${pythonExe}" -c "import torch_directml; print('DML_OK:', torch_directml.is_available())"`;
      
      exec(verifyCmd, { windowsHide: true }, (err, stdout, stderr) => {
        const output = stdout.trim() + '\n' + stderr.trim();
        if (output.includes('DML_OK: True')) {
          updateStatus('success', 100, 'Tăng tốc GPU AMD/Intel (DirectML) thành công!', `\n[SUCCESS] Xác thực DirectML thành công: ${output}\n`);
        } else {
          updateStatus('failed', 90, 'Xác thực DirectML thất bại', `\n[ERROR] Xác thực thất bại: ${output}\n`);
        }
      });
    }
  } catch (err) {
    updateStatus('failed', 0, `Lỗi cài đặt: ${err.message}`, `\n[FATAL ERROR] Tiến trình bị hủy do lỗi: ${err.message}\n`);
  }
}

main();
