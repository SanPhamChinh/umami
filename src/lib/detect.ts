import path from 'path';
import { browserName, detectOS } from 'detect-browser';
import isLocalhost from 'is-localhost-ip';
import ipaddr from 'ipaddr.js';
import maxmind from 'maxmind';
import {
  DESKTOP_OS,
  DESKTOP_SCREEN_WIDTH,
  IP_ADDRESS_HEADERS,
  LAPTOP_SCREEN_WIDTH,
  MOBILE_OS,
  MOBILE_SCREEN_WIDTH,
} from './constants';
import { safeDecodeURIComponent } from '@/lib/url';

const MAXMIND = 'maxmind';

export function getIpAddress(headers: Headers) {
  // 1. 首先尝试获取 Cloudflare 的真实 IP
  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp;
  }

  // 2. 检查自定义 header
  const customHeader = process.env.CLIENT_IP_HEADER;
  if (customHeader && headers.get(customHeader)) {
    return headers.get(customHeader);
  }

  // 3. 尝试从 x-forwarded-for 获取
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    // 返回第一个 IP（最原始的客户端 IP）
    return forwardedFor.split(',')[0]?.trim();
  }

  // 4. 尝试其他常见的 IP headers
  for (const name of IP_ADDRESS_HEADERS) {
    const ip = headers.get(name);
    if (ip) {
      if (name === 'forwarded') {
        const match = ip.match(/for=(\[?[0-9a-fA-F:.]+\]?)/);
        if (match) {
          return match[1];
        }
      }
      return ip;
    }
  }

  return null;
}

export function getDevice(screen: string, os: string) {
  if (!screen) return;

  const [width] = screen.split('x');

  if (DESKTOP_OS.includes(os)) {
    if (os === 'Chrome OS' || +width < DESKTOP_SCREEN_WIDTH) {
      return 'laptop';
    }
    return 'desktop';
  } else if (MOBILE_OS.includes(os)) {
    if (os === 'Amazon OS' || +width > MOBILE_SCREEN_WIDTH) {
      return 'tablet';
    }
    return 'mobile';
  }

  if (+width >= DESKTOP_SCREEN_WIDTH) {
    return 'desktop';
  } else if (+width >= LAPTOP_SCREEN_WIDTH) {
    return 'laptop';
  } else if (+width >= MOBILE_SCREEN_WIDTH) {
    return 'tablet';
  } else {
    return 'mobile';
  }
}

function getRegionCode(country: string, region: string) {
  if (!country || !region) {
    return undefined;
  }

  return region.includes('-') ? region : `${country}-${region}`;
}

function decodeHeader(s: string | undefined | null): string | undefined | null {
  if (s === undefined || s === null) {
    return s;
  }

  return Buffer.from(s, 'latin1').toString('utf-8');
}

export async function getLocation(ip: string = '', headers: Headers, hasPayloadIP: boolean) {
  // Ignore local ips
  if (await isLocalhost(ip)) {
    return;
  }

  if (!hasPayloadIP && !process.env.SKIP_LOCATION_HEADERS) {
    // Cloudflare headers
    if (headers.get('cf-ipcountry')) {
      const country = decodeHeader(headers.get('cf-ipcountry'));
      const region = decodeHeader(headers.get('cf-region-code'));
      const city = decodeHeader(headers.get('cf-ipcity'));

      return {
        country,
        region: getRegionCode(country, region),
        city,
      };
    }

    // Vercel headers
    if (headers.get('x-vercel-ip-country')) {
      const country = decodeHeader(headers.get('x-vercel-ip-country'));
      const region = decodeHeader(headers.get('x-vercel-ip-country-region'));
      const city = decodeHeader(headers.get('x-vercel-ip-city'));

      return {
        country,
        region: getRegionCode(country, region),
        city,
      };
    }
  }

  // Database lookup
  if (!global[MAXMIND]) {
    const dir = path.join(process.cwd(), 'geo');

    global[MAXMIND] = await maxmind.open(
      process.env.GEOLITE_DB_PATH || path.resolve(dir, 'GeoLite2-City.mmdb'),
    );
  }

  // When the client IP is extracted from headers, sometimes the value includes a port
  const cleanIp = ip?.split(':')[0];
  const result = global[MAXMIND].get(cleanIp);

  if (result) {
    const country = result.country?.iso_code ?? result?.registered_country?.iso_code;
    const region = result.subdivisions?.[0]?.iso_code;
    const city = result.city?.names?.en;

    return {
      country,
      region: getRegionCode(country, region),
      city,
    };
  }
}

export async function getClientInfo(request: Request, payload: Record<string, any>) {
  const userAgent = payload?.userAgent || request.headers.get('user-agent');
  const ip = payload?.ip || getIpAddress(request.headers);
  const location = await getLocation(ip, request.headers, !!payload?.ip);
  const country = safeDecodeURIComponent(location?.country);
  const region = safeDecodeURIComponent(location?.region);
  const city = safeDecodeURIComponent(location?.city);
  const browser = browserName(userAgent);
  const os = detectOS(userAgent) as string;
  const device = getDevice(payload?.screen, os);

  return { userAgent, browser, os, ip, country, region, city, device };
}

export function hasBlockedIp(clientIp: string) {
  const ignoreIps = process.env.IGNORE_IP;

  if (ignoreIps) {
    const ips = [];

    if (ignoreIps) {
      ips.push(...ignoreIps.split(',').map(n => n.trim()));
    }

    return ips.find(ip => {
      if (ip === clientIp) {
        return true;
      }

      // CIDR notation
      if (ip.indexOf('/') > 0) {
        const addr = ipaddr.parse(clientIp);
        const range = ipaddr.parseCIDR(ip);

        if (addr.kind() === range[0].kind() && addr.match(range)) {
          return true;
        }
      }
    });
  }

  return false;
}
