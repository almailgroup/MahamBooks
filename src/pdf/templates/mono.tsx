import type { Style } from '@react-pdf/types';
import { Text, View } from './primitives';
import {
  DocShell,
  ItemsTable,
  Label,
  Lines,
  Logo,
  LogoRow,
  PageFooter,
  RunningHeader,
  Stamp,
  TotalsSection,
  clientLines,
  companyContactLines,
  companyIdLine,
  en,
  fitSize,
  isRtl,
  joinAddress,
  sx,
} from './shared';
import { templateMeta } from '../template-meta';
import type { TemplateDefinition, TemplateProps } from './types';

const NIGHT = '#0b1220';
const GRID = '#e2e8f0';
/** The white card the logo sits on in the dark header. */
const LOGO_CHIP: Style = {
  backgroundColor: '#ffffff',
  borderRadius: 4,
  paddingVertical: 6,
  paddingHorizontal: 10,
};

/**
 * The status stamp with the logo on its own line, from the top of the rule
 * under the header: on the line between the header and the summary, as it
 * prints without that line. The header is then shorter by however much the
 * logo took in it, so a fixed shift from the top of the page can't follow.
 */
const STAMP_TOP = -21;
const STAMP_TOP_RTL = -18;

function Mono({ model, theme }: TemplateProps) {
  const c = model.company;
  const mono = theme.fonts.mono;
  const label: Style = {
    fontFamily: mono,
    fontSize: 6.5,
    fontWeight: 500,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 5,
  };
  const cell: Style = { flex: 1, padding: 10, borderRightWidth: 0.75, borderRightColor: GRID };

  return (
    <DocShell model={model} theme={theme} pageStyle={{ paddingTop: 0 }} logoRow={false}>
      <View
        style={{
          backgroundColor: NIGHT,
          marginHorizontal: -40,
          paddingHorizontal: 40,
          paddingTop: 34,
          paddingBottom: 22,
          marginBottom: 0,
        }}
      >
        <LogoRow model={model} chip={LOGO_CHIP} />
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          <View style={{ width: '55%' }}>
            {c.logo ? (
              <View style={sx({ alignSelf: 'flex-start', marginBottom: 10 }, LOGO_CHIP)}>
                <Logo src={c.logo} width={130} height={36} />
              </View>
            ) : null}
            <Text
              style={{
                fontFamily: mono,
                fontSize: c.logo ? 9 : 14,
                fontWeight: 600,
                color: '#ffffff',
              }}
            >
              {c.name}
            </Text>
            {c.nameSecondary ? (
              <Text
                style={{
                  fontFamily: mono,
                  fontSize: c.logo ? 7.5 : 9,
                  color: '#cbd5e1',
                  marginTop: 1,
                }}
              >
                {c.nameSecondary}
              </Text>
            ) : null}
            <Text
              style={{
                fontFamily: mono,
                fontSize: 7,
                color: '#94a3b8',
                marginTop: 3,
                lineHeight: 1.5,
              }}
            >
              {[joinAddress(model, c.addressLines), companyContactLines(model, false).join(' · ')]
                .filter(Boolean)
                .join('\n')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text
              style={{
                fontFamily: mono,
                fontSize: 22,
                fontWeight: 600,
                color: theme.accentBright,
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              {model.title}
            </Text>
            {model.titleSecondary ? (
              <Text
                style={{
                  fontFamily: mono,
                  fontSize: 9,
                  color: '#94a3b8',
                  textTransform: 'uppercase',
                  letterSpacing: 1.5,
                }}
              >
                {model.titleSecondary}
              </Text>
            ) : null}
            {model.number ? (
              <Text style={{ fontFamily: mono, fontSize: 10, color: '#ffffff', marginTop: 3 }}>
                {model.number}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
      {/* The rule, the summary and the status stamp over them: the stamp is
          placed from where the header ends, however tall the header is. */}
      <View>
        <View
          style={{
            height: 3,
            backgroundColor: theme.accent,
            marginHorizontal: -40,
            marginBottom: 18,
          }}
        />

        <View
          style={{ flexDirection: 'row', borderWidth: 0.75, borderColor: GRID, marginBottom: 18 }}
        >
          <View style={sx(cell, { flex: 1.3 })}>
            <Label
              text={model.recipientLabel}
              secondary={model.recipientLabelSecondary}
              style={label}
            />
            <Text style={{ fontSize: 9.5, fontWeight: 700, color: theme.ink, marginBottom: 2 }}>
              {model.client.name || '—'}
            </Text>
            {model.client.nameSecondary ? (
              <Text style={{ fontSize: 8, fontWeight: 600, color: theme.body, marginBottom: 2 }}>
                {model.client.nameSecondary}
              </Text>
            ) : null}
            <Lines
              lines={clientLines(model, false)}
              style={{ fontSize: 7.5, color: theme.body, lineHeight: 1.45 }}
            />
          </View>
          {model.shipTo ? (
            <View style={cell}>
              <Label text={model.labels.shipTo} secondary={en(model, 'shipTo')} style={label} />
              <Text style={{ fontSize: 9, fontWeight: 700, color: theme.ink, marginBottom: 2 }}>
                {model.shipTo.name}
              </Text>
              <Lines
                lines={model.shipTo.lines}
                style={{ fontSize: 7.5, color: theme.body, lineHeight: 1.45 }}
              />
            </View>
          ) : null}
          <View style={cell}>
            {model.meta.map((m) => (
              <View key={m.label} style={{ marginBottom: 7 }}>
                <Label
                  text={m.label}
                  secondary={m.secondary}
                  style={sx(label, { marginBottom: 1 })}
                  stack
                />
                <Text style={{ fontFamily: mono, fontSize: 8.5, color: theme.ink }}>{m.value}</Text>
              </View>
            ))}
          </View>
          <View
            style={sx(cell, {
              borderRightWidth: 0,
              backgroundColor: '#f8fafc',
              alignItems: 'flex-end',
            })}
          >
            <Label
              text={model.amountDue.label}
              secondary={model.amountDue.secondary}
              style={sx(label, { textAlign: 'right' })}
              stack
            />
            <Text
              style={{
                fontFamily: mono,
                fontSize: fitSize(model.amountDue.value, 15, 15),
                fontWeight: 600,
                color: theme.ink,
              }}
            >
              {model.amountDue.value}
            </Text>
            {model.amountDue.caption ? (
              <Text style={{ fontFamily: mono, fontSize: 6.5, color: theme.muted, marginTop: 4 }}>
                {model.amountDue.caption}
              </Text>
            ) : null}
            {model.deposit ? (
              <Text
                style={{
                  fontFamily: mono,
                  fontSize: 6.5,
                  color: theme.accentInk,
                  marginTop: 6,
                  textAlign: 'right',
                }}
              >
                {`${model.deposit.label}: ${model.deposit.value}`}
              </Text>
            ) : null}
          </View>
        </View>

        {model.logo.row ? (
          <Stamp
            model={model}
            theme={theme}
            anchored
            style={{ top: isRtl(model) ? STAMP_TOP_RTL : STAMP_TOP, right: 20 }}
          />
        ) : null}
      </View>

      {/* Placed before the table so it always lands on the first page. Without
          the logo's own line, where it always printed. */}
      {model.logo.row ? null : (
        <Stamp model={model} theme={theme} style={{ top: isRtl(model) ? 134 : 150, right: 60 }} />
      )}

      <ItemsTable
        model={model}
        theme={theme}
        styles={{
          container: { borderWidth: 0.75, borderColor: GRID },
          header: { backgroundColor: '#f8fafc', borderBottomWidth: 0.75, borderBottomColor: GRID },
          headerText: {
            fontFamily: mono,
            fontSize: 6.5,
            fontWeight: 500,
            color: theme.muted,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          },
          row: { borderTopWidth: 0.5, borderTopColor: GRID, paddingVertical: 7 },
          cell: { fontFamily: mono, fontSize: 8 },
          amount: { fontFamily: mono, fontWeight: 600 },
          columnLines: GRID,
          headingText: {
            fontFamily: mono,
            fontSize: 8,
            fontWeight: 600,
            color: theme.accentInk,
            textTransform: 'uppercase',
          },
        }}
      />

      <TotalsSection
        model={model}
        theme={theme}
        titleStyle={label}
        style={{ marginTop: 16 }}
        totals={{
          width: 240,
          container: { borderWidth: 0.75, borderColor: GRID },
          row: {
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderBottomWidth: 0.5,
            borderBottomColor: GRID,
          },
          label: { fontFamily: mono, fontSize: 7.5 },
          value: { fontFamily: mono, fontSize: 8 },
          strongRow: {
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderBottomWidth: 0.5,
            borderBottomColor: GRID,
          },
          grandRow: { backgroundColor: NIGHT, paddingHorizontal: 10, paddingVertical: 9 },
          grandLabel: {
            fontFamily: mono,
            color: '#ffffff',
            fontSize: 8.5,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          },
          grandValue: { fontFamily: mono, color: theme.accentBright, fontSize: 12.5 },
          note: { paddingHorizontal: 10 },
        }}
      />

      {companyIdLine(model) ? (
        <Text
          fixed
          style={{
            position: 'absolute',
            left: 40,
            right: 40,
            bottom: 36,
            fontFamily: mono,
            fontSize: 6.5,
            color: theme.faint,
          }}
        >
          {companyIdLine(model)}
        </Text>
      ) : null}
      <RunningHeader
        model={model}
        theme={theme}
        style={{ fontFamily: mono, color: '#94a3b8', top: 12 }}
      />
      <PageFooter model={model} theme={theme} textStyle={{ fontFamily: mono, fontSize: 6.5 }} />
    </DocShell>
  );
}

export const mono: TemplateDefinition = {
  ...templateMeta('mono'),
  fonts: { body: 'plexsans', heading: 'plexsans', mono: 'jetbrainsmono' },
  render: (props) => <Mono {...props} />,
};
