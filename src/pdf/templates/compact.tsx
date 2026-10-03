import type { Style } from '@react-pdf/types';
import { Text, View } from './primitives';
import {
  DocShell,
  ItemsTable,
  Label,
  Lines,
  Logo,
  MetaRows,
  PageFooter,
  Party,
  RunningHeader,
  Stamp,
  TNUM,
  TotalsSection,
  clientLines,
  companyContactLines,
  companyIdLine,
  DOT,
  en,
  fitSize,
  joinAddress,
  sx,
} from './shared';
import { templateMeta } from '../template-meta';
import type { TemplateDefinition, TemplateProps } from './types';

/** Dense layout for documents with many line items. */
function Compact({ model, theme }: TemplateProps) {
  const c = model.company;
  const label: Style = {
    fontSize: 6.5,
    fontWeight: 700,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 3,
  };

  return (
    <DocShell
      model={model}
      theme={theme}
      pageStyle={{ paddingTop: 30, paddingHorizontal: 32, paddingBottom: 52, fontSize: 8 }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          paddingBottom: 10,
          borderBottomWidth: 2,
          borderBottomColor: theme.accent,
          marginBottom: 12,
        }}
      >
        <View style={{ flexDirection: 'row', width: '64%' }}>
          {c.logo ? <Logo src={c.logo} width={96} height={38} style={{ marginRight: 12 }} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: 700, color: theme.ink }}>{c.name}</Text>
            {c.nameSecondary ? (
              <Text style={{ fontSize: 8, fontWeight: 600, color: theme.body }}>
                {c.nameSecondary}
              </Text>
            ) : null}
            <Lines
              lines={[
                joinAddress(model, c.addressLines),
                companyContactLines(model, false).join(DOT),
                companyIdLine(model),
              ]}
              style={{ fontSize: 7, color: theme.muted, lineHeight: 1.4, marginTop: 1 }}
            />
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: theme.accentInk,
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            {model.title}
          </Text>
          {model.titleSecondary ? (
            <Text
              style={{
                fontSize: 7.5,
                fontWeight: 700,
                color: theme.accentInk,
                textTransform: 'uppercase',
                letterSpacing: 1.2,
              }}
            >
              {model.titleSecondary}
            </Text>
          ) : null}
          {model.number ? (
            <Text
              style={sx({ fontSize: 9, fontWeight: 600, color: theme.ink, marginTop: 1 }, TNUM)}
            >
              {model.number}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        <Party
          style={{ flex: 1.3, paddingRight: 12 }}
          label={model.recipientLabel}
          labelSecondary={model.recipientLabelSecondary}
          name={model.client.name}
          nameSecondary={model.client.nameSecondary}
          lines={clientLines(model)}
          labelStyle={label}
          nameStyle={{ fontSize: 9, color: theme.ink }}
          linesStyle={{ fontSize: 7.5, color: theme.body, lineHeight: 1.4 }}
        />
        {model.shipTo ? (
          <Party
            style={{ flex: 1, paddingRight: 12 }}
            label={model.labels.shipTo}
            labelSecondary={en(model, 'shipTo')}
            name={model.shipTo.name}
            lines={model.shipTo.lines}
            labelStyle={label}
            nameStyle={{ fontSize: 9, color: theme.ink }}
            linesStyle={{ fontSize: 7.5, color: theme.body, lineHeight: 1.4 }}
          />
        ) : null}
        <View style={{ flex: 1, paddingRight: 12 }}>
          <MetaRows
            rows={[...model.meta, ...(model.deposit ? [model.deposit] : [])]}
            labelStyle={{ fontSize: 7.5, color: theme.muted }}
            valueStyle={{ fontSize: 7.5, fontWeight: 600, color: theme.ink }}
            rowStyle={{ paddingVertical: 1.5 }}
          />
        </View>
        <View
          style={{
            width: 140,
            backgroundColor: theme.accentSoft,
            borderRadius: 4,
            paddingVertical: 8,
            paddingHorizontal: 10,
            alignItems: 'flex-end',
          }}
        >
          <Label
            text={model.amountDue.label}
            secondary={model.amountDue.secondary}
            style={sx(label, { color: theme.accentInk, textAlign: 'right' })}
            stack
          />
          <Text
            style={sx(
              {
                fontSize: fitSize(model.amountDue.value, 14, 14),
                fontWeight: 700,
                color: theme.accentInk,
              },
              TNUM,
            )}
          >
            {model.amountDue.value}
          </Text>
          {model.amountDue.caption ? (
            <Text style={{ fontSize: 6.5, color: theme.muted, marginTop: 2 }}>
              {model.amountDue.caption}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Placed before the table so it always lands on the first page. */}
      <Stamp model={model} theme={theme} size={16} style={{ top: 26, right: 200 }} />

      <ItemsTable
        model={model}
        theme={theme}
        styles={{
          fontSize: 8,
          rowPaddingY: 4,
          cellPaddingX: 6,
          header: { backgroundColor: theme.accentSoft, paddingVertical: 4 },
          headerText: {
            color: theme.accentInk,
            fontSize: 6.5,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          },
          row: { borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb' },
          zebra: '#f8fafc',
          title: { fontWeight: 500 },
          detail: { fontSize: 7, marginTop: 1 },
          headingRow: { paddingTop: 7, paddingBottom: 3 },
          headingText: {
            fontSize: 8,
            color: theme.accentInk,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          },
        }}
      />

      <TotalsSection
        model={model}
        theme={theme}
        titleStyle={label}
        textStyle={{ fontSize: 7.5 }}
        style={{ marginTop: 10 }}
        bandStyle={{ marginTop: 12, paddingTop: 9 }}
        totals={{
          width: 210,
          row: { paddingHorizontal: 6, paddingVertical: 2.5 },
          label: { fontSize: 8 },
          value: { fontSize: 8 },
          strongRow: {
            paddingHorizontal: 6,
            borderTopWidth: 0.5,
            borderTopColor: '#e5e7eb',
            marginTop: 2,
            paddingTop: 4,
          },
          grandRow: {
            backgroundColor: theme.accent,
            paddingHorizontal: 8,
            paddingVertical: 6,
            marginTop: 4,
            borderRadius: 3,
          },
          grandLabel: { color: theme.onAccent, fontSize: 9 },
          grandValue: { color: theme.onAccent, fontSize: 11 },
          note: { paddingHorizontal: 6 },
        }}
      />

      <RunningHeader model={model} theme={theme} marginX={32} style={{ top: 14 }} />
      <PageFooter model={model} theme={theme} marginX={32} style={{ bottom: 18 }} />
    </DocShell>
  );
}

export const compact: TemplateDefinition = {
  ...templateMeta('compact'),
  fonts: { body: 'plexsans', heading: 'plexsans', mono: 'jetbrainsmono' },
  render: (props) => <Compact {...props} />,
};
