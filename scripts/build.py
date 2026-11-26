#!/usr/bin/env python3
"""Build public GitHub Pages and a self-contained private sync Worker."""
import base64
import hashlib
import html
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def payload(value):
    return json.dumps(value, ensure_ascii=False).replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')


def main():
    subprocess.run(['node', str(ROOT / 'scripts/validate.mjs')], check=True)
    data = json.loads((ROOT / 'data/nav.json').read_text())
    config = json.loads((ROOT / 'data/client-config.json').read_text())
    api = config.get('apiBase', '').rstrip('/')
    if api:
        url = urlsplit(api)
        if url.scheme != 'https' or not url.hostname or url.path not in ('', '/') or url.query or url.fragment or url.username:
            raise ValueError('同步服务地址必须是独立 HTTPS 源站')
    css = (ROOT / 'src/style.css').read_text()
    model = (ROOT / 'src/model.mjs').read_text()
    model = re.sub(r'^export\s+', '', model, flags=re.M)
    app = re.sub(r'^import[^\n]+\n', '', (ROOT / 'src/app.js').read_text(), flags=re.M)
    script = '(() => {\n\"use strict\";\n' + model + '\n' + app + '\n})();'
    # No executable script-closing sequence can appear in the inline bundle.
    if re.search(r'</script', script, re.I):
        raise ValueError('脚本包含不安全的结束标签')
    digest = hashlib.sha256((css + script + payload(data) + payload(config)).encode()).hexdigest()[:12]
    config['buildId'] = digest
    script_hash = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
    template = (ROOT / 'src/index.html').read_text()

    def render(private=False):
        cfg = {**config, 'privateApp': private}
        if private:
            cfg['apiBase'] = ''
        csp = f"default-src 'none'; script-src 'sha256-{script_hash}'; style-src 'unsafe-inline'; connect-src 'self'" + ('' if private or not api else ' ' + api) + "; img-src 'self' data:; base-uri 'none'; object-src 'none'; form-action 'self'; frame-src 'none'"
        replacements = {'__NAV_DATA__': payload(data), '__CLIENT_CONFIG__': payload(cfg), '__STYLE__': css, '__SCRIPT__': script, '__CSP__': html.escape(csp, quote=True)}
        result = template
        for key, value in replacements.items():
            if result.count(key) != 1:
                raise ValueError('模板数据插槽缺失或重复：' + key)
            result = result.replace(key, value)
        return result

    out = ROOT / 'dist'
    out.mkdir(exist_ok=True)
    page = render()
    for target in [out / 'index.html', ROOT / 'index.html']:
        target.write_text(page)
    (out / '.nojekyll').write_text('')
    (ROOT / '.nojekyll').write_text('')
    (out / 'version.json').write_text(payload({'buildId': digest, 'release': config['release']}))
    (ROOT / 'version.json').write_text(payload({'buildId': digest, 'release': config['release']}))
    worker_app = render(True)
    (ROOT / 'worker/generated-app.mjs').write_text('export const APP_HTML = ' + json.dumps(worker_app, ensure_ascii=False) + ';\nexport const APP_BUILD_ID = ' + json.dumps(digest) + ';\n')
    server = re.sub(r'^import[^\n]+\n', '', (ROOT / 'worker/index.mjs').read_text(), flags=re.M)
    server = server.replace('export async function handle', 'async function handle')
    bundle = ROOT / 'dist-worker'
    bundle.mkdir(exist_ok=True)
    (bundle / 'worker.mjs').write_text(model + '\nconst APP_HTML = ' + json.dumps(worker_app, ensure_ascii=False) + ';\nconst APP_BUILD_ID = ' + json.dumps(digest) + ';\n' + server)
    print(f"构建完成：v{config['release']} · {digest} · {len(data['links'])} 公开 / {data['privateCount']} 私密")


if __name__ == '__main__':
    main()
