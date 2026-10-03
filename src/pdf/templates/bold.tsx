import type { Style } from '@react-pdf/types';
import { Text, View } from './primitives';
import {
  DocShell,
  ItemsTable,
  Label,
  Lines,
  Logo,
  PageFooter,
  RunningHeader,
  Stamp,
  TNUM,
  TotalsSection,
  clientLines,
  companyContactLines,
  companyIdLine,
  en,
  fitSize,
  sx,
} from './shared';
import { templateMeta } from '../template-meta';
import type { TemplateDefinition, TemplateProps } from './types';

const DARK = '#111827';

function Bold({ model, theme }: TemplateProps) {
  const c = model.company;
  const darkLabel: Style = {
    fontSize: 7,
    fontWeight: 600,
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 5,
  };
  const sectionTitle: Style = {
    fontSize: 8,
    fontWeight: 700,
    color: DARK,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 5,
  };

  return (
    <DocShell
      model={model}
      theme={theme}
      pageStyle={{ paddingTop: 38, paddingHorizontal: 42, paddingBottom: 70 }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 }}>
        <View style={{ width: '52%' }}>
          <Text
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: 44,
              fontWeight: 700,
              color: DARK,
              letterSpacing: -1.5,
              textTransform: 'uppercase',
              lineHeight: 1,
            }}
          >
            {model.title}
          </Text>
          {model.titleSecondary ? (
            <Text
              style={{
                fontFamily: theme.fonts.heading,
                fontSize: 15,
                fontWeight: 700,
                color: theme.muted,
                textTransform: 'uppercase',
                letterSpacing: 2,
                marginTop: 4,
              }}
            >
              {model.titleSecondary}
            </Text>
          ) : null}
          <View style={{ width: 54, height: 5, backgroundColor: theme.accent, marginTop: 10 }} />
          {model.number ? (
            <Text style={sx({ fontSize: 11, fontWeight: 600, color: DARK, marginTop: 10 }, TNUM)}>
              {model.number}
            </Text>
          ) : null}
        </View>
        <View style={{ width: '44%', alignItems: 'flex-end' }}>
          {c.logo ? <Logo src={c.logo} width={150} height={46} align="right" /> : null}
          <Text
            style={{
              fontSize: c.logo ? 9.5 : 15,
              fontWeight: 700,
              color: DARK,
              marginTop: c.logo ? 8 : 0,
              textAlign: 'right',
            }}
          >
            {c.name}
          </Text>
          {c.nameSecondary ? (
            <Text
              style={{
                fontSize: c.logo ? 8.5 : 10,
                fontWeight: 600,
                color: theme.body,
                marginTop: 1,
                textAlign: 'right',
              }}
            >
              {c.nameSecondary}
            </Text>
          ) : null}
          <Lines
            lines={[...c.addressLines, ...companyContactLines(model), companyIdLine(model)]}
            style={{
              fontSize: 7.5,
              color: theme.muted,
              lineHeight: 1.45,
              textAlign: 'right',
              marginTop: 2,
            }}
          />
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          backgroundColor: DARK,
          paddingVertical: 15,
          paddingHorizontal: 16,
          marginBottom: 20,
        }}
      >
        <View style={{ flex: 1.3, paddingRight: 14 }}>
          <Label
            text={model.recipientLabel}
            secondary={model.recipientLabelSecondary}
            style={darkLabel}
          />
          <Text style={{ fontSize: 10.5, fontWeight: 700, color: '#ffffff', marginBottom: 3 }}>
            {model.client.name || '—'}
          </Text>
          {model.client.nameSecondary ? (
            <Text style={{ fontSize: 8.5, fontWeight: 600, color: '#e5e7eb', marginBottom: 3 }}>
              {model.client.nameSecondary}
            </Text>
          ) : null}
          <Lines
            lines={clientLines(model, false)}
            style={{ fontSize: 8, color: '#d1d5db', lineHeight: 1.45 }}
          />
        </View>
        {model.shipTo ? (
          <View style={{ flex: 1, paddingRight: 14 }}>
            <Label text={model.labels.shipTo} secondary={en(model, 'shipTo')} style={darkLabel} />
            <Text style={{ fontSize: 9.5, fontWeight: 700, color: '#ffffff', marginBottom: 3 }}>
              {model.shipTo.name}
            </Text>
            <Lines
              lines={model.shipTo.lines}
              style={{ fontSize: 8, color: '#d1d5db', lineHeight: 1.45 }}
            />
          </View>
        ) : null}
        <View style={{ flex: 0.9, paddingRight: 14 }}>
          {model.meta.map((m) => (
            <View key={m.label} style={{ marginBottom: 8 }}>
              <Label
                text={m.label}
                secondary={m.secondary}
                style={sx(darkLabel, { marginBottom: 2 })}
                stack
              />
              <Text style={sx({ fontSize: 9, fontWeight: 600, color: '#ffffff' }, TNUM)}>
                {m.value}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View style={{ alignItems: 'flex-end' }}>
            <Label
              text={model.amountDue.label}
              secondary={model.amountDue.secondary}
              style={sx(darkLabel, { textAlign: 'right' })}
              stack
            />
            <Text
              style={sx(
                {
                  fontFamily: theme.fonts.heading,
                  fontSize: fitSize(model.amountDue.value, 20, 15),
                  fontWeight: 700,
                  color: theme.accentBright,
                  textAlign: 'right',
                },
                TNUM,
              )}
            >
              {model.amountDue.value}
            </Text>
            {model.amountDue.caption ? (
              <Text style={{ fontSize: 7.5, color: '#9ca3af', marginTop: 3, textAlign: 'right' }}>
                {model.amountDue.caption}
              </Text>
            ) : null}
          </View>
          {model.deposit ? (
            <Text
              style={sx(
                { fontSize: 7.5, color: '#d1d5db', marginTop: 8, textAlign: 'right' },
                TNUM,
              )}
            >
              {`${model.deposit.label}: ${model.deposit.value}${model.deposit.caption ? ` · ${model.deposit.caption}` : ''}`}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Placed before the table so it always lands on the first page. */}
      <Stamp model={model} theme={theme} style={{ top: 112, right: 250 }} />

      <ItemsTable
        model={model}
        theme={theme}
        styles={{
          cellPaddingX: 6,
          header: { borderBottomWidth: 2, borderBottomColor: DARK, paddingTop: 2 },
          headerText: {
            color: DARK,
            fontSize: 7.5,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.7,
          },
          row: { borderBottomWidth: 0.75, borderBottomColor: '#e5e7eb', paddingVertical: 7.5 },
          title: { fontWeight: 700, color: DARK },
          amount: { fontWeight: 700, color: DARK },
          headingRow: { borderBottomWidth: 0.75, borderBottomColor: DARK },
          headingText: { textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 8.5 },
        }}
      />

      <TotalsSection
        model={model}
        theme={theme}
        titleStyle={sectionTitle}
        style={{ marginTop: 16 }}
        bandStyle={{ borderTopColor: '#e5e7eb' }}
        totals={{
          width: 240,
          row: { paddingHorizontal: 6, paddingVertical: 3.5 },
          strongRow: {
            paddingHorizontal: 6,
            borderTopWidth: 0.75,
            borderTopColor: '#e5e7eb',
            marginTop: 3,
            paddingTop: 6,
          },
          grandRow: {
            backgroundColor: theme.accent,
            paddingHorizontal: 12,
            paddingVertical: 11,
            marginTop: 6,
          },
          grandLabel: {
            color: theme.onAccent,
            fontSize: 10.5,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          },
          grandValue: { color: theme.onAccent, fontSize: 16, fontFamily: theme.fonts.heading },
          note: { paddingHorizontal: 6 },
        }}
      />

      <View
        fixed
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 8,
          backgroundColor: theme.accent,
        }}
      />
      <RunningHeader model={model} theme={theme} marginX={42} />
      <PageFooter model={model} theme={theme} marginX={42} style={{ bottom: 24 }} />
    </DocShell>
  );
}

export const bold: TemplateDefinition = {
  ...templateMeta('bold'),
  fonts: { body: 'spacegrotesk', heading: 'spacegrotesk', mono: 'jetbrainsmono' },
  render: (props) => <Bold {...props} />,
};
