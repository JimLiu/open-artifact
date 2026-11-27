import {
  Bot,
  CalendarDays,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  SeparatorHorizontal,
  SquareChevronDown,
  SquareCode,
  Table2,
  TableOfContents,
  TextQuote,
  User,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { InsertIcon } from './plugin.ts';

const ICONS: Record<InsertIcon, LucideIcon> = {
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  table: Table2,
  dropdown: SquareChevronDown,
  bullet: List,
  check: ListChecks,
  code: SquareCode,
  contents: TableOfContents,
  date: CalendarDays,
  divider: SeparatorHorizontal,
  image: Image,
  ordered: ListOrdered,
  quote: TextQuote,
  person: User,
  agent: Bot,
  tab: FileText,
};

export function ItemIcon({ icon, className = 'size-4' }: { icon: InsertIcon; className?: string }): ReactNode {
  const Icon = ICONS[icon];
  return <Icon className={className} strokeWidth={1.75} aria-hidden="true" />;
}
