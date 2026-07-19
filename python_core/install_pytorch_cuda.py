import os
import sys
import re
import urllib.request
import urllib.parse
import tempfile
import subprocess

def get_latest_wheel(package, py_ver):
    url = f'https://download.pytorch.org/whl/cu121/{package}/'
    print(f"Fetching links from {url}...", flush=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            html = response.read().decode('utf-8')
            hrefs = re.findall(r'href="([^"]*)"', html)
            matching = []
            for h in hrefs:
                # Remove clean url query/fragments
                clean_h = h.split('#')[0].split('?')[0]
                if py_ver in clean_h and 'win_amd64' in clean_h:
                    matching.append(h)
            if matching:
                # The links are sorted, so the last one is usually the latest version
                latest_link = matching[-1]
                # Rewrite download-r2.pytorch.org to download.pytorch.org to bypass Cloudflare SSL handshake issues
                latest_link = latest_link.replace('download-r2.pytorch.org', 'download.pytorch.org')
                print(f"Found latest {package} wheel: {latest_link}", flush=True)
                return latest_link
    except Exception as e:
        print(f"Error fetching/parsing {package} index: {e}", flush=True)
    return None

def download_file(url, dest_path, name):
    # Ensure we use download.pytorch.org instead of download-r2.pytorch.org
    url = url.replace('download-r2.pytorch.org', 'download.pytorch.org')
    print(f"Starting download of {name} from {url}...", flush=True)

    # Remove #sha256 if present
    download_url = url.split('#')[0]

    req = urllib.request.Request(download_url, headers={'User-Agent': 'Mozilla/5.0'})
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(req) as response:
                total_size = int(response.info().get('Content-Length', 0))
                bytes_so_far = 0
                chunk_size = 4 * 1024 * 1024  # 4 MB chunk

                with open(dest_path, 'wb') as f:
                    while True:
                        chunk = response.read(chunk_size)
                        if not chunk:
                            break
                        f.write(chunk)
                        bytes_so_far += len(chunk)
                        if total_size > 0:
                            percent = int(bytes_so_far * 100 / total_size)
                            # Print progress updates so they are read by node worker
                            print(f"[{name}] Download progress: {percent}% ({bytes_so_far // (1024*1024)}MB / {total_size // (1024*1024)}MB)", flush=True)
                print(f"Successfully downloaded {name}.", flush=True)
                return True
        except Exception as e:
            print(f"Attempt {attempt} failed to download {name}: {e}", flush=True)
            if os.path.exists(dest_path):
                try:
                    os.remove(dest_path)
                except:
                    pass
            if attempt == 3:
                raise e

def main():
    print("=== PyTorch CUDA 12.1 Custom Installer ===", flush=True)
    py_ver = f"cp{sys.version_info.major}{sys.version_info.minor}"
    print(f"Python version detected: {py_ver}", flush=True)

    # Check fallback availability
    fallbacks = {
        'torch': 'https://download.pytorch.org/whl/cu121/torch-2.5.1%2Bcu121-cp311-cp311-win_amd64.whl',
        'torchvision': 'https://download.pytorch.org/whl/cu121/torchvision-0.20.1%2Bcu121-cp311-cp311-win_amd64.whl',
        'torchaudio': 'https://download.pytorch.org/whl/cu121/torchaudio-2.5.1%2Bcu121-cp311-cp311-win_amd64.whl'
    }

    urls = {}
    for pkg in ['torch', 'torchvision', 'torchaudio']:
        url = get_latest_wheel(pkg, py_ver)
        if url:
            urls[pkg] = url
        else:
            if py_ver == 'cp311' and pkg in fallbacks:
                print(f"Using fallback URL for {pkg}", flush=True)
                urls[pkg] = fallbacks[pkg]
            else:
                print(f"ERROR: Could not find wheel URL for {pkg} (version tag: {py_ver})", flush=True)
                sys.exit(1)

    # Create temp directory
    temp_dir = tempfile.mkdtemp(prefix='pytorch_cuda_install_')
    print(f"Temporary download folder created: {temp_dir}", flush=True)

    local_files = []
    try:
        for pkg, url in urls.items():
            filename = url.split('/')[-1].split('#')[0]
            # Replace hex escapes if any
            filename = urllib.parse.unquote(filename)
            local_path = os.path.join(temp_dir, filename)

            download_file(url, local_path, pkg)
            local_files.append(local_path)

        print("All wheels downloaded successfully. Installing via pip...", flush=True)

        # Build command: python -m pip install wheel1 wheel2 wheel3 --no-cache-dir
        cmd = [sys.executable, '-m', 'pip', 'install'] + local_files + ['--no-cache-dir', '--force-reinstall']
        print(f"Running command: {' '.join(cmd)}", flush=True)

        # Run pip install and stream output
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in process.stdout:
            print(line, end='', flush=True)

        process.wait()
        if process.returncode == 0:
            print("PyTorch CUDA packages installed successfully!", flush=True)
        else:
            print(f"pip install failed with exit code {process.returncode}", flush=True)
            sys.exit(process.returncode)

    finally:
        # Clean up
        print("Cleaning up temporary downloaded files...", flush=True)
        for f in local_files:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception as e:
                    print(f"Failed to remove {f}: {e}", flush=True)
        try:
            os.rmdir(temp_dir)
        except Exception as e:
            print(f"Failed to remove temp dir {temp_dir}: {e}", flush=True)

if __name__ == '__main__':
    main()
