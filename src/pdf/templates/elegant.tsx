import type { Style } from '@react-pdf/types';
import { Text, View } from './primitives';
import {
  DocShell,
  ItemsTable,
  Label,
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

const INK = '#1c1917';
const BODY = '#44403c';
const MUTED = '#78716c';
const RULE = '#e7e5e4';

function Elegant({ model, theme }: TemplateProps) {
  const c = model.company;
  const smallCaps: Style = {
    fontSize: 7.5,
    color: theme.accentInk,
    textTransform: 'uppercase',
    letterSpacing: 1.6,
    marginBottom: 6,
  };
  const doubleRule = (
    <View style={{ marginVertical: 12 }}>
      <View style={{ borderTopWidth: 0.75, borderTopColor: theme.accent }} />
      <View style={{ borderTopWidth: 0.4, borderTopColor: theme.accent, marginTop: 2 }} />
    </View>
  );

  return (
    <DocShell
      model={model}
      theme={theme}
      pageStyle={{ paddingTop: 36, paddingHorizontal: 50, color: BODY }}
    >
      <View style={{ alignItems: 'center' }}>
        {c.logo ? <Logo src={c.logo} width={160} height={44} align="center" /> : null}
        <Text
          style={{
            fontFamily: theme.fonts.heading,
            fontSize: c.logo ? 13 : 22,
            color: INK,
            marginTop: c.logo ? 8 : 0,
            letterSpacing: c.logo ? 0.4 : 0.2,
          }}
        >
          {c.name}
        </Text>
        {c.nameSecondary ? (
          <Text
            style={{
              fontFamily: theme.fonts.heading,
              fontSize: c.logo ? 10 : 13,
              color: BODY,
              marginTop: 2,
            }}
          >
            {c.nameSecondary}
          </Text>
        ) : null}
        <Text
          style={{
            fontSize: 7.5,
            color: MUTED,
            marginTop: 4,
            textAlign: 'center',
            letterSpacing: 0.3,
            lineHeight: 1.5,
          }}
        >
          {[joinAddress(model, c.addressLines), companyContactLines(model, false).join(DOT)]
            .filter(Boolean)
            .join('\n')}
        </Text>
      </View>

      {doubleRule}

      <View style={{ alignItems: 'center', marginBottom: 14 }}>
        <Text
          style={{
            fontFamily: theme.fonts.heading,
            fontStyle: 'italic',
            fontSize: 27,
            color: INK,
          }}
        >
          {model.title}
        </Text>
        {model.titleSecondary ? (
          <Text
            style={{
              fontFamily: theme.fonts.heading,
              fontStyle: 'italic',
              fontSize: 13,
              color: theme.accentInk,
            }}
          >
            {model.titleSecondary}
          </Text>
        ) : null}
        {model.number ? (
          <Text
            style={sx(
              {
                fontSize: 8,
                color: MUTED,
                letterSpacing: 2.2,
                marginTop: 4,
                textTransform: 'uppercase',
              },
              TNUM,
            )}
          >
            {model.number}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 18 }}>
        <Party
          style={{ flex: 1.2, paddingRight: 18 }}
          label={model.recipientLabel}
          labelSecondary={model.recipientLabelSecondary}
          name={model.client.name}
          nameSecondary={model.client.nameSecondary}
          lines={clientLines(model, false)}
          labelStyle={smallCaps}
          nameStyle={{ fontFamily: theme.fonts.heading, fontSize: 12, fontWeight: 400, color: INK }}
          linesStyle={{ color: BODY }}
        />
        {model.shipTo ? (
          <Party
            style={{ flex: 1, paddingRight: 18 }}
            label={model.labels.shipTo}
            labelSecondary={en(model, 'shipTo')}
            name={model.shipTo.name}
            lines={model.shipTo.lines}
            labelStyle={smallCaps}
            nameStyle={{
              fontFamily: theme.fonts.heading,
              fontSize: 11,
              fontWeight: 400,
              color: INK,
            }}
            linesStyle={{ color: BODY }}
          />
        ) : null}
        <View style={{ flex: 1, paddingTop: 13 }}>
          <MetaRows
            rows={[...model.meta, ...(model.deposit ? [model.deposit] : [])]}
            labelStyle={{ fontSize: 8.5, color: MUTED, fontStyle: 'italic' }}
            valueStyle={{ fontSize: 8.5, color: INK }}
            rowStyle={{ paddingVertical: 2.5, borderBottomWidth: 0.4, borderBottomColor: RULE }}
          />
          <View style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <Label
              text={model.amountDue.label}
              secondary={model.amountDue.secondary}
              style={sx(smallCaps, { marginBottom: 2 })}
            />
            <Text
              style={sx(
                {
                  fontFamily: theme.fonts.heading,
                  fontSize: fitSize(model.amountDue.value, 18, 18),
                  color: INK,
                },
                TNUM,
              )}
            >
              {model.amountDue.value}
            </Text>
          </View>
        </View>
      </View>

      {/* Placed before the table so it always lands on the first page. */}
      <Stamp model={model} theme={theme} style={{ top: 150, right: 56 }} />

      <ItemsTable
        model={model}
        theme={theme}
        styles={{
          cellPaddingX: 4,
          header: {
            borderTopWidth: 0.75,
            borderTopColor: theme.accent,
            borderBottomWidth: 0.75,
            borderBottomColor: theme.accent,
            paddingVertical: 6,
          },
          headerText: {
            color: theme.accentInk,
            fontSize: 7,
            textTransform: 'uppercase',
            letterSpacing: 1.3,
            fontWeight: 400,
          },
          row: { borderBottomWidth: 0.4, borderBottomColor: RULE, paddingVertical: 7 },
          title: { fontWeight: 600, color: INK },
          detail: { fontStyle: 'italic', color: MUTED },
          cell: { color: BODY },
          amount: { color: INK, fontWeight: 600 },
          headingText: {
            fontFamily: theme.fonts.heading,
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 11,
            color: theme.accentInk,
          },
        }}
      />

      <TotalsSection
        model={model}
        theme={theme}
        titleStyle={smallCaps}
        textStyle={{ color: BODY }}
        style={{ marginTop: 16 }}
        bandStyle={{ borderTopColor: RULE }}
        totals={{
          width: 220,
          row: { paddingVertical: 3.5 },
          label: { color: MUTED, fontStyle: 'italic' },
          value: { color: INK },
          strongRow: { borderTopWidth: 0.4, borderTopColor: RULE, marginTop: 3, paddingTop: 6 },
          grandRow: {
            borderTopWidth: 0.75,
            borderTopColor: theme.accent,
            borderBottomWidth: 0.75,
            borderBottomColor: theme.accent,
            marginTop: 8,
            paddingVertical: 8,
          },
          grandLabel: {
            fontFamily: theme.fonts.heading,
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 12,
            color: INK,
          },
          grandValue: {
            fontFamily: theme.fonts.heading,
            fontSize: 15,
            fontWeight: 700,
            color: INK,
          },
        }}
      />

      {companyIdLine(model) ? (
        <Text
          fixed
          style={{
            position: 'absolute',
            left: 50,
            right: 50,
            bottom: 36,
            fontSize: 7,
            color: MUTED,
            textAlign: 'center',
            letterSpacing: 0.3,
          }}
        >
          {companyIdLine(model)}
        </Text>
      ) : null}
      <RunningHeader model={model} theme={theme} marginX={50} />
      <PageFooter model={model} theme={theme} marginX={50} textStyle={{ color: MUTED }} />
    </DocShell>
  );
}

export const elegant: TemplateDefinition = {
  ...templateMeta('elegant'),
  fonts: { body: 'lora', heading: 'playfair', mono: 'jetbrainsmono' },
  render: (props) => <Elegant {...props} />,
};
