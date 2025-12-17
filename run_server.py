#!/usr/bin/env python3
import argparse
import os
import sys
import subprocess
import shutil
import time


UNITS = {
    'B': 1,
    'KB': 1024,
    'MB': 1024**2,
    'GB': 1024**3,
    'TB': 1024**4,
}


def parse_size(s):
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    try:
        # try raw number first
        return int(float(s))
    except ValueError:
        pass
    up = s.upper()
    for k in ['TB', 'GB', 'MB', 'KB', 'B']:
        if up.endswith(k):
            num = up[:-len(k)].strip()
            try:
                return int(float(num) * UNITS[k])
            except ValueError:
                break
    raise ValueError('Invalid size string: %r' % s)


def ensure_node():
    node = shutil.which('node')
    if not node:
        print('Error: node is not installed or not in PATH', file=sys.stderr)
        sys.exit(1)
    return node


def maybe_npm_install(project_root, force=False):
    node_modules = os.path.join(project_root, 'node_modules')
    if force or not os.path.isdir(node_modules):
        npm = shutil.which('npm')
        if not npm:
            print('Error: npm is not installed or not in PATH', file=sys.stderr)
            sys.exit(1)
        print('Installing npm dependencies...')
        rc = subprocess.call([npm, 'install'], cwd=project_root)
        if rc != 0:
            print('npm install failed with code', rc, file=sys.stderr)
            sys.exit(rc)


def start_node(project_root, port, root_dir, quota, background=False):
    env = os.environ.copy()
    env['PORT'] = str(port)
    env['ROOT_DIR'] = os.path.abspath(root_dir)
    if quota is not None:
        env['QUOTA_BYTES'] = str(quota)

    node = ensure_node()
    cmd = [node, 'src/server.js']

    if background:
        if os.name == 'nt':
            # Windows: DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            CREATE_NEW_PROCESS_GROUP = 0x00000200
            DETACHED_PROCESS = 0x00000008
            flags = CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS
            subprocess.Popen(cmd, cwd=project_root, env=env,
                             creationflags=flags,
                             stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL,
                             stdin=subprocess.DEVNULL)
        else:
            # POSIX: run detached session
            subprocess.Popen(cmd, cwd=project_root, env=env,
                             preexec_fn=os.setsid,
                             stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL,
                             stdin=subprocess.DEVNULL)
        print('Started in background on http://localhost:%s' % port)
        return 0
    else:
        print('Starting server on http://localhost:%s' % port)
        p = subprocess.Popen(cmd, cwd=project_root, env=env)
        try:
            rc = p.wait()
            return rc
        except KeyboardInterrupt:
            print('\nStopping...')
            try:
                p.terminate()
                for _ in range(30):
                    if p.poll() is not None:
                        break
                    time.sleep(0.1)
                if p.poll() is None:
                    p.kill()
            finally:
                return 0


def main():
    parser = argparse.ArgumentParser(description='Run Web File Server via Python launcher')
    parser.add_argument('--project', default='.', help='Project root (contains package.json)')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '3000')), help='Port to listen (default 3000)')
    parser.add_argument('--root', default=os.environ.get('ROOT_DIR', os.path.join('.', 'storage')), help='Storage root directory')
    parser.add_argument('--quota', default=os.environ.get('QUOTA_BYTES'), help='Quota in bytes or human string (e.g., 10GB). Negative/empty means unlimited')
    parser.add_argument('--install', action='store_true', help='Force run npm install before start')
    parser.add_argument('--background', action='store_true', help='Start in background (detach)')
    args = parser.parse_args()

    project_root = os.path.abspath(args.project)
    quota = None
    if args.quota is not None:
        try:
            q = parse_size(args.quota)
            if q is not None and q >= 0:
                quota = q
        except ValueError as e:
            print('Invalid --quota:', e, file=sys.stderr)
            sys.exit(2)

    # Ensure storage dir exists
    os.makedirs(os.path.abspath(args.root), exist_ok=True)

    maybe_npm_install(project_root, force=args.install)
    rc = start_node(project_root, args.port, args.root, quota, background=args.background)
    sys.exit(rc)


if __name__ == '__main__':
    main()
