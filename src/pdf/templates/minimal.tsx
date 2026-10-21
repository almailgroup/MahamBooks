import type { Style } from '@react-pdf/types';
import { Text, View } from './primitives';
import {
  DocShell,
  ItemsTable,
  Label,
  Lines,
  Logo,
  PageFooter,
  Party,
  RunningHeader,
  Stamp,
  TNUM,
  TotalsSection,
  clientLines,
  companyContactLines,
  companyIdLine,
  en,
  fitSize,
  joinAddress,
  sx,
} from './shared';
import { templateMeta } from '../template-meta';
import type { TemplateDefinition, TemplateProps } from './types';

/**
 * The status stamp with the logo on its own line, from the top of the title:
 * just above the amount due, as it prints without that line (the header is
 * then shorter by what the logo took in it).
 */
const STAMP_TOP = 24;

function Minimal({ model, theme }: TemplateProps) {
  const c = model.company;
  const label: Style = {
    fontSize: 7,
    color: theme.faint,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 5,
  };
  const hairline = { borderBottomWidth: 0.5, borderBottomColor: '#d4d4d8' };

  const facts = [
    ...(model.number
      ? [{ label: model.numberLabel, secondary: model.numberLabelSecondary, value: model.number }]
      : []),
    ...model.meta,
  ];
  // Up to four facts per row; more (delivery date and place) wrap to a second row.
  const perRow = Math.max(1, Math.min(facts.length, 4));

  return (
    <DocShell model={model} theme={theme} pageStyle={{ paddingTop: 48, paddingHorizontal: 48 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 26 }}>
        <View style={{ width: '50%' }}>
          {c.logo ? (
            <Logo src={c.logo} width={140} height={44} />
          ) : (
            <View>
              <Text
                style={{ fontSize: 14, fontWeight: 700, color: theme.ink, letterSpacing: -0.2 }}
              >
                {c.name}
              </Text>
              {c.nameSecondary ? (
                <Text style={{ fontSize: 9, color: theme.muted, marginTop: 2 }}>
                  {c.nameSecondary}
                </Text>
              ) : null}
            </View>
          )}
        </View>
        <View style={{ width: '45%' }}>
          <Lines
            lines={[
              c.logo ? c.name : '',
              c.logo ? c.nameSecondary : '',
              joinAddress(model, c.addressLines),
              ...companyContactLines(model),
              companyIdLine(model),
            ]}
            style={{ fontSize: 7.5, color: theme.muted, lineHeight: 1.55, textAlign: 'right' }}
          />
        </View>
      </View>

      {/* The title and the facts, with the status stamp over them: placed from
          where the header ends, however tall the header is. */}
      <View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            marginBottom: model.titleSecondary ? 3 : 16,
          }}
        >
          <Text style={{ fontSize: 30, fontWeight: 400, color: theme.ink, letterSpacing: -0.6 }}>
            {model.title}
          </Text>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: theme.accent,
              marginLeft: 4,
              marginBottom: 7,
            }}
          />
        </View>
        {model.titleSecondary ? (
          <Text
            style={{
              fontSize: 8,
              color: theme.faint,
              textTransform: 'uppercase',
              letterSpacing: 2.4,
              marginBottom: 16,
            }}
          >
            {model.titleSecondary}
          </Text>
        ) : null}

        <View style={sx({ flexDirection: 'row', paddingBottom: 12, marginBottom: 18 }, hairline)}>
          <View style={{ flex: perRow, flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 }}>
            {facts.map((f) => (
              <View key={f.label} style={{ width: `${100 / perRow}%`, paddingRight: 10 }}>
                <Label text={f.label} secondary={f.secondary} style={label} stack />
                <Text style={sx({ fontSize: 9.5, fontWeight: 600, color: theme.ink }, TNUM)}>
                  {f.value}
                </Text>
              </View>
            ))}
          </View>
          <View style={{ flex: 1.2, alignItems: 'flex-end' }}>
            <Label
              text={model.amountDue.label}
              secondary={model.amountDue.secondary}
              style={sx(label, { textAlign: 'right' })}
              stack
            />
            <Text
              style={sx(
                {
                  fontSize: fitSize(model.amountDue.value, 14, 16),
                  fontWeight: 700,
                  color: theme.accentInk,
                },
                TNUM,
              )}
            >
              {model.amountDue.value}
            </Text>
          </View>
        </View>
        {model.logo.row ? (
          <Stamp model={model} theme={theme} anchored style={{ top: STAMP_TOP, right: 32 }} />
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 20 }}>
        <Party
          style={{ flex: model.shipTo ? 1 : 2, paddingRight: 20 }}
          label={model.recipientLabel}
          labelSecondary={model.recipientLabelSecondary}
          name={model.client.name}
          nameSecondary={model.client.nameSecondary}
          lines={clientLines(model, !model.shipTo)}
          labelStyle={label}
          nameStyle={{ fontSize: 10, color: theme.ink }}
          linesStyle={{ color: theme.body }}
        />
        {model.shipTo ? (
          <Party
            style={{ flex: 1, paddingRight: 20 }}
            label={model.labels.shipTo}
            labelSecondary={en(model, 'shipTo')}
            name={model.shipTo.name}
            lines={model.shipTo.lines}
            labelStyle={label}
            nameStyle={{ fontSize: 10, color: theme.ink }}
            linesStyle={{ color: theme.body }}
          />
        ) : null}
        <View style={{ flex: 0.8 }}>
          {model.deposit ? (
            <View>
              <Label text={model.deposit.label} secondary={model.deposit.secondary} style={label} />
              <Text style={sx({ fontSize: 10, fontWeight: 700, color: theme.ink }, TNUM)}>
                {model.deposit.value}
              </Text>
              {model.deposit.caption ? (
                <Text style={{ fontSize: 8, color: theme.muted }}>{model.deposit.caption}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {/* Placed before the table so it always lands on the first page. Without
          the logo's own line, where it always printed. */}
      {model.logo.row ? null : (
        <Stamp model={model} theme={theme} style={{ top: 168, right: 80 }} />
      )}

      <ItemsTable
        model={model}
        theme={theme}
        styles={{
          cellPaddingX: 0,
          header: sx(hairline, { paddingTop: 0, paddingBottom: 7 }),
          headerText: {
            fontSize: 7,
            color: theme.faint,
            letterSpacing: 1.1,
            textTransform: 'uppercase',
            fontWeight: 400,
          },
          row: { borderBottomWidth: 0.5, borderBottomColor: '#ececf0', paddingVertical: 7.5 },
          title: { fontWeight: 600 },
          amount: { fontWeight: 600 },
          headingText: {
            fontSize: 8,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: theme.accentInk,
          },
          widths: {},
        }}
      />

      <TotalsSection
        model={model}
        theme={theme}
        titleStyle={label}
        style={{ marginTop: 18 }}
        bandStyle={{ borderTopColor: '#ececf0', marginTop: 22, paddingTop: 16 }}
        totals={{
          width: 220,
          row: { paddingVertical: 3.5 },
          strongRow: {
            borderTopWidth: 0.5,
            borderTopColor: '#d4d4d8',
            marginTop: 4,
            paddingTop: 7,
          },
          grandRow: { borderTopWidth: 1.2, borderTopColor: theme.ink, marginTop: 6, paddingTop: 9 },
          grandLabel: { fontWeight: 600 },
          grandValue: { fontSize: 14, fontWeight: 700, color: theme.ink },
        }}
      />

      <RunningHeader model={model} theme={theme} marginX={48} />
      <PageFooter model={model} theme={theme} marginX={48} />
    </DocShell>
  );
}

export const minimal: TemplateDefinition = {
  ...templateMeta('minimal'),
  fonts: { body: 'manrope', heading: 'manrope', mono: 'jetbrainsmono' },
  render: (props) => <Minimal {...props} />,
};
