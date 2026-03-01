import { describe, expect, it } from 'vitest';
import nginxConf from '../../nginx.conf?raw';

describe('nginx upstream resilience', () => {
  it('retries transient backend gateway errors on /api', () => {
    expect(nginxConf).toContain('proxy_next_upstream error timeout http_502 http_503 http_504');
    expect(nginxConf).toContain('proxy_next_upstream_tries 3;');
  });

  it('uses explicit proxy timeouts for /api', () => {
    expect(nginxConf).toContain('proxy_connect_timeout 5s;');
    expect(nginxConf).toContain('proxy_read_timeout 60s;');
    expect(nginxConf).toContain('proxy_send_timeout 60s;');
  });

  it('forces https redirect for the public hostname while keeping local fallback', () => {
    expect(nginxConf).toContain('"epl.marcovogt.ch:http" 1;');
    expect(nginxConf).toContain('return 301 https://$host$request_uri;');
    expect(nginxConf).toContain('proxy_set_header X-Forwarded-Proto $forwarded_proto;');
  });
});
