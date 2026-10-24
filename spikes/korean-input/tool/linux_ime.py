#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Observe real X11 -> fcitx5 -> GTK IM -> Flutter input, never inject Unicode.

This is a research recorder: criterion failures are data, not a runner failure.
Infrastructure failures (missing window/trace/Hangul) exit nonzero.
"""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import platform

BINARY = Path(sys.argv[1]).resolve()
OUTPUT = Path(sys.argv[2]).resolve()
PHRASE = '동해물과 백두산이'
# 동(ehd) 해(go) 물(anf) 과(rhk) 백(qor) 두(en) 산(tks) 이(dl)
KEYS = 'ehdgoanfrhk qorentksdl'
records = []
processes = []
recording_stop = threading.Event()


def record_screen(directory):
    """Sample actual displayed frames; screenshots alone are not a recording."""
    index = 0
    while not recording_stop.is_set():
        run('import', '-window', 'root', str(directory / f'{index:05d}.png'))
        index += 1
        recording_stop.wait(0.5)


def run(*args, check=True):
    return subprocess.run(args, text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=check)


def key(*keys):
    run('xdotool', 'key', '--clearmodifiers', *keys)
    time.sleep(0.18)


def type_keys(text, delay=12):
    run('xdotool', 'type', '--clearmodifiers', '--delay', str(delay), text)
    time.sleep(0.25)


def trace(path, prefix):
    result = []
    for line in path.read_text(errors='replace').splitlines():
        if prefix in line:
            result.append(json.loads(line.split(prefix, 1)[1]))
    return result


def window(title, process):
    for _ in range(150):
        if process.poll() is not None:
            raise RuntimeError(f'{title} exited before presenting its window')
        found = run('xdotool', 'search', '--onlyvisible', '--name', title, check=False)
        if found.returncode == 0 and found.stdout.strip():
            wid = found.stdout.strip().splitlines()[-1]
            run('xdotool', 'windowfocus', '--sync', wid)
            run('xdotool', 'windowmove', wid, '0', '0')
            run('xdotool', 'windowsize', wid, '1000', '720')
            time.sleep(1)
            return wid
        time.sleep(0.1)
    raise RuntimeError(f'no visible {title} window')


def snap(name, path, prefix):
    time.sleep(0.3)
    events = trace(path, prefix)
    if not events:
        raise RuntimeError(f'no instrumented events for {name}')
    row = {'scenario': name, 'last': events[-1], 'events': len(events)}
    records.append(row)
    run('import', '-window', 'root', str(OUTPUT / f'{name}.png'))
    print(json.dumps(row, ensure_ascii=False), flush=True)
    return row['last']


def launch(args, name, env):
    path = OUTPUT / f'{name}.raw.txt'
    with path.open('w') as log:
        process = subprocess.Popen(args, env=env, stdout=log, stderr=log)
    processes.append(process)
    return process, path


def reset(wid):
    run('xdotool', 'windowfocus', '--sync', wid)
    run('fcitx5-remote', '-c')
    key('Escape', 'ctrl+a', 'BackSpace')
    run('fcitx5-remote', '-s', 'hangul')
    run('fcitx5-remote', '-o')
    time.sleep(0.2)
    if run('fcitx5-remote', '-n').stdout.strip() != 'hangul':
        raise RuntimeError('the focused field is not using fcitx5-hangul')


def scenarios(kind, args, title, prefix, env):
    process, path = launch(args, kind, env)
    wid = window(title, process)
    reset(wid)
    type_keys('gks')
    snap(f'{kind}-01-inline', path, prefix)
    key('F9')
    snap(f'{kind}-02-candidates', path, prefix)
    key('Return')
    snap(f'{kind}-03-candidate-enter', path, prefix)
    reset(wid)
    type_keys(KEYS, delay=1)
    snap(f'{kind}-04-fast-preedit', path, prefix)
    key('Return')
    snap(f'{kind}-05-first-enter', path, prefix)
    key('Return')
    snap(f'{kind}-06-second-enter', path, prefix)
    reset(wid)
    type_keys('gks')
    key('BackSpace')
    snap(f'{kind}-07-backspace', path, prefix)
    key('Left')
    snap(f'{kind}-08-left', path, prefix)
    type_keys('rk')
    snap(f'{kind}-09-edit-after-left', path, prefix)
    reset(wid)
    type_keys('gks')
    key('Tab' if kind == 'flutter' else 'ctrl+Tab')
    snap(f'{kind}-10-focus-away', path, prefix)
    key('shift+Tab' if kind == 'flutter' else 'ctrl+shift+Tab')
    type_keys('rmf')
    snap(f'{kind}-11-focus-return', path, prefix)
    reset(wid)
    type_keys('gks')
    key('Right')
    key('shift+Return')
    snap(f'{kind}-12-newline', path, prefix)
    if kind == 'flutter':
        reset(wid)
        run('fcitx5-remote', '-c')
        key('F9')
        snap(f'{kind}-13-shortcut-idle', path, prefix)
        # Bounded stress at three XTest delays, not a physical typing claim.
        for delay in (0, 1, 12):
            for trial in range(5):
                reset(wid)
                type_keys(KEYS, delay=delay)
                events = trace(path, prefix)
                last = events[-1]
                records.append({'scenario': f'flutter-speed-{delay}-{trial}', 'last': last})
        if not any(e.get('text') == PHRASE for e in trace(path, prefix)):
            raise RuntimeError('real fcitx path never delivered the Korean phrase')
    events = trace(path, prefix)
    (OUTPUT / f'{kind}-events.json').write_text(
        json.dumps(events, ensure_ascii=False, indent=2) + '\n')
    process.terminate()
    process.wait(timeout=10)


try:
    (OUTPUT / 'environment.json').write_text(json.dumps({
        'system': platform.system(),
        'release': platform.release(),
        'machine': platform.machine(),
        'flutter': {key: value for key, value in json.loads(
            run('flutter', '--version', '--machine').stdout).items()
            if key in ('frameworkVersion', 'frameworkRevision', 'engineRevision',
                       'dartSdkVersion', 'channel')},
        'packages': run('dpkg-query', '-W', 'fcitx5', 'fcitx5-hangul',
                        'fcitx5-frontend-gtk3', 'libhangul1', 'libgtk-3-0t64').stdout,
        'backend': 'Xvfb X11 / XTest / GTK_IM_MODULE=fcitx',
        'physicalDevice': False,
        'binarySha256': hashlib.sha256(BINARY.read_bytes()).hexdigest(),
        'sourceSha256': hashlib.sha256(Path('lib/main.dart').read_bytes()).hexdigest(),
        'hangulConfig': 'Keyboard=2; HanjaMode=False; HanjaKey=F9',
    }, indent=2) + '\n')
    with tempfile.TemporaryDirectory(prefix='korean-ime-') as temporary:
        config = Path(temporary) / 'config'
        (config / 'fcitx5' / 'conf').mkdir(parents=True)
        (config / 'fcitx5' / 'profile').write_text('''[Groups/0]
Name=Research
Default Layout=us
DefaultIM=hangul

[Groups/0/Items/0]
Name=keyboard-us
Layout=

[Groups/0/Items/1]
Name=hangul
Layout=

[GroupOrder]
0=Research
''')
        (config / 'fcitx5' / 'conf' / 'hangul.conf').write_text(
            'Keyboard=2\nHanjaMode=False\n[HanjaKey]\n0=F9\n')
        env = dict(os.environ, XDG_CONFIG_HOME=str(config),
                   XDG_CACHE_HOME=str(Path(temporary) / 'cache'),
                   GTK_IM_MODULE='fcitx', QT_IM_MODULE='fcitx',
                   XMODIFIERS='@im=fcitx', GDK_BACKEND='x11',
                   LIBGL_ALWAYS_SOFTWARE='1')
        # Child helpers must query the same private D-Bus service/config.
        os.environ.update(env)
        ime, ime_path = launch(['fcitx5', '--disable=wayland',
                                '--verbose=key_trace=5'], 'fcitx', env)
        for _ in range(100):
            ready = run('fcitx5-remote', '--check', check=False)
            if ready.returncode == 0 and ready.stdout.strip() in ('0', '1', '2'):
                break
            time.sleep(0.1)
        else:
            raise RuntimeError('private fcitx5 service did not start')
        frames = Path(temporary) / 'frames'
        frames.mkdir()
        recorder = threading.Thread(target=record_screen, args=(frames,), daemon=True)
        recorder.start()
        try:
            scenarios('flutter', [str(BINARY)], '^korean_input$', 'IME_TRACE ', env)
            scenarios('gtk', [sys.executable, 'tool/gtk_reference.py'],
                      '^GTK Korean reference$', 'GTK_TRACE ', env)
        finally:
            recording_stop.set()
            recorder.join(timeout=10)
        run('convert', '-limit', 'memory', '128MiB', '-limit', 'map', '256MiB',
            '-delay', '50', '-loop', '0',
            *(str(frame) for frame in sorted(frames.glob('*.png'))),
            '-resize', '800x500', '-layers', 'Optimize', str(OUTPUT / 'linux-x11.gif'))
        (OUTPUT / 'observations.json').write_text(
            json.dumps(records, ensure_ascii=False, indent=2) + '\n')
        # Keep only key-event diagnostics; exclude environment/absolute paths.
        lines = ime_path.read_text(errors='replace').splitlines()
        (OUTPUT / 'fcitx-keys.txt').write_text(
            '\n'.join(line for line in lines if 'key_trace' in line) + '\n')
finally:
    recording_stop.set()
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
