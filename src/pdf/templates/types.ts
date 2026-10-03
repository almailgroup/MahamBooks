import type { ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';
import type { FontId } from '../fonts';
import type { RenderModel } from '../model';
import type { TemplateMeta } from '../template-meta';

export interface TemplateTheme {
  /** Brand accent as chosen by the user. */
  accent: string;
  /** Text color to use on an accent background. */
  onAccent: string;
  /** Accent darkened when needed so it is readable as text on white. */
  accentInk: string;
  /** Very light accent tint for panels. */
  accentSoft: string;
  /** Light accent tint for borders and dividers. */
  accentLine: string;
  /** Accent lightened when needed so it is readable on dark backgrounds. */
  accentBright: string;
  ink: string;
  body: string;
  muted: string;
  faint: string;
  line: string;
  surface: string;
  /** Font stacks: the template's font, then the Arabic fallback. */
  fonts: { body: string[]; heading: string[]; mono: string[] };
  /** Page width in points (A4 595.28, Letter 612). */
  pageWidth: number;
  pageHeight: number;
}

export interface TemplateProps {
  model: RenderModel;
  theme: TemplateTheme;
}

export interface TemplateDefinition extends TemplateMeta {
  fonts: { body: FontId; heading: FontId; mono: FontId };
  /** Must return a react-pdf <Document>. */
  render: (props: TemplateProps) => ReactElement<DocumentProps>;
}
