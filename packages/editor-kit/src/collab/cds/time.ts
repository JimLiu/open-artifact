import { localize } from '@open-artifact/runtime';

export function commentTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  if (now.getTime() - at.getTime() < 60_000) return localize('now', '刚刚');
  const time = at.toLocaleTimeString(localize('en-US', 'zh-CN'), { hour: 'numeric', minute: '2-digit' });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return localize(`Yesterday, ${time}`, `昨天 ${time}`);
  const date = at.toLocaleDateString(localize('en-US', 'zh-CN'), {
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return localize(`${date}, ${time}`, `${date} ${time}`);
}

export function commentAgo(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return localize('now', '刚刚');
  if (minutes < 60) return localize(`${minutes}m`, `${minutes} 分钟前`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return localize(`${hours}h`, `${hours} 小时前`);
  const days = Math.floor(hours / 24);
  if (days < 7) return localize(`${days}d`, `${days} 天前`);
  return at.toLocaleDateString(localize('en-US', 'zh-CN'), {
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}
