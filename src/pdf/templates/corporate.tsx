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
  StatusPill,
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

const SLATE = '#1e293b';

function Corporate({ model, theme }: TemplateProps) {
  const c = model.company;
  const boxLabel: Style = {
    fontSize: 7,
    fontWeight: 700,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    backgroundColor: '#eef2f7',
    paddingVertical: 4,
    paddingHorizontal: 9,
  };
  const sectionTitle: Style = {
    fontSize: 7.5,
    fontWeight: 700,
    color: SLATE,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 5,
  };
  const box: Style = {
    flex: 1,
    borderWidth: 0.75,
    borderColor: '#dbe2ea',
    borderRadius: 3,
  };

  return (
    <DocShell model={model} theme={theme} pageStyle={{ paddingTop: 40 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
        <View style={{ width: '55%' }}>
          {c.logo ? (
            <Logo src={c.logo} width={170} height={50} />
          ) : (
            <Text style={{ fontSize: 17, fontWeight: 700, color: SLATE }}>{c.name}</Text>
          )}
          <View style={{ marginTop: 10 }}>
            {c.logo ? (
              <Text style={{ fontSize: 9, fontWeight: 700, color: SLATE, marginBottom: 2 }}>
                {c.name}
              </Text>
            ) : null}
            {c.nameSecondary ? (
              <Text style={{ fontSize: 8.5, fontWeight: 600, color: theme.body, marginBottom: 2 }}>
                {c.nameSecondary}
              </Text>
            ) : null}
            <Lines
              lines={[...c.addressLines, ...companyContactLines(model)]}
              style={{ fontSize: 8, color: theme.muted, lineHeight: 1.45 }}
            />
          </View>
        </View>
        <View
          style={{
            width: 200,
            backgroundColor: theme.accent,
            borderRadius: 4,
            paddingVertical: 14,
            paddingHorizontal: 16,
          }}
        >
          <Text
            style={{
              fontSize: 19,
              fontWeight: 700,
              color: theme.onAccent,
              textTransform: 'uppercase',
              letterSpacing: 1.5,
            }}
          >
            {model.title}
          </Text>
          {model.titleSecondary ? (
            <Text
              style={{
                fontSize: 8,
                fontWeight: 700,
                color: theme.onAccent,
                opacity: 0.85,
                textTransform: 'uppercase',
                letterSpacing: 1.8,
              }}
            >
              {model.titleSecondary}
            </Text>
          ) : null}
          {model.number ? (
            <Text
              style={sx(
                { fontSize: 9.5, color: theme.onAccent, opacity: 0.85, marginTop: 2 },
                TNUM,
              )}
            >
              {model.number}
            </Text>
          ) : null}
          <View
            style={{
              marginTop: 12,
              paddingTop: 9,
              borderTopWidth: 0.75,
              borderTopColor: theme.onAccent,
              opacity: 1,
            }}
          >
            <Label
              text={model.amountDue.label}
              secondary={model.amountDue.secondary}
              style={{
                fontSize: 7,
                color: theme.onAccent,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
              }}
            />
            <Text
              style={sx(
                {
                  fontSize: fitSize(model.amountDue.value, 16, 18),
                  fontWeight: 700,
                  color: theme.onAccent,
                  marginTop: 2,
                },
                TNUM,
              )}
            >
              {model.amountDue.value}
            </Text>
            <StatusPill model={model} color={theme.onAccent} style={{ marginTop: 6 }} />
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 20 }}>
        <View style={sx(box, { marginRight: 10 })}>
          <Label
            text={model.recipientLabel}
            secondary={model.recipientLabelSecondary}
            style={boxLabel}
          />
          <Party
            style={{ padding: 9 }}
            name={model.client.name}
            nameSecondary={model.client.nameSecondary}
            lines={clientLines(model)}
            nameStyle={{ fontSize: 9.5, color: SLATE }}
            linesStyle={{ fontSize: 8, color: theme.body, lineHeight: 1.45 }}
          />
        </View>
        {model.shipTo ? (
          <View style={sx(box, { marginRight: 10 })}>
            <Label text={model.labels.shipTo} secondary={en(model, 'shipTo')} style={boxLabel} />
            <Party
              style={{ padding: 9 }}
              name={model.shipTo.name}
              lines={model.shipTo.lines}
              nameStyle={{ fontSize: 9.5, color: SLATE }}
              linesStyle={{ fontSize: 8, color: theme.body, lineHeight: 1.45 }}
            />
          </View>
        ) : null}
        <View style={box}>
          <Label text={model.title} secondary={model.titleSecondary} style={boxLabel} />
          <View style={{ padding: 9 }}>
            <MetaRows
              rows={[
                ...(model.number
                  ? [
                      {
                        label: model.numberLabel,
                        secondary: model.numberLabelSecondary,
                        value: model.number,
                      },
                    ]
                  : []),
                ...model.meta,
                ...(model.deposit ? [model.deposit] : []),
              ]}
              labelStyle={{ fontSize: 8, color: theme.muted }}
              valueStyle={{ fontSize: 8.5, fontWeight: 600, color: SLATE }}
              rowStyle={{ paddingVertical: 2.5 }}
            />
          </View>
        </View>
      </View>

      <ItemsTable
        model={model}
        theme={theme}
        styles={{
          header: { backgroundColor: SLATE },
          headerText: {
            color: '#ffffff',
            fontSize: 7.5,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          },
          row: { borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0', paddingVertical: 6.5 },
          zebra: '#f8fafc',
          lastRow: { borderBottomWidth: 1.5, borderBottomColor: SLATE },
          headingRow: { backgroundColor: theme.accentSoft },
          headingText: { color: theme.accentInk, fontSize: 8.5 },
          title: { color: SLATE },
        }}
      />

      <TotalsSection
        model={model}
        theme={theme}
        titleStyle={sectionTitle}
        style={{ marginTop: 14 }}
        totals={{
          width: 240,
          container: { borderWidth: 0.75, borderColor: '#dbe2ea', borderRadius: 3 },
          row: {
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderBottomWidth: 0.5,
            borderBottomColor: '#eef2f7',
          },
          strongRow: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#f8fafc' },
          grandRow: { backgroundColor: theme.accent, paddingHorizontal: 10, paddingVertical: 8 },
          grandLabel: { color: theme.onAccent },
          grandValue: { color: theme.onAccent, fontSize: 12.5 },
          note: { paddingHorizontal: 10 },
        }}
      />

      {/* The company's numbers above the footer, in the same box: a footer of two
          lines (Arabic and English) would otherwise run into them. */}
      <PageFooter
        model={model}
        theme={theme}
        textStyle={{ color: theme.muted }}
        lead={companyIdLine(model)}
        leadStyle={{ fontSize: 7, marginBottom: 2 }}
        style={{ bottom: 20, borderTopWidth: 1.5, borderTopColor: theme.accent, paddingTop: 6 }}
      />
      <RunningHeader model={model} theme={theme} />
    </DocShell>
  );
}

export const corporate: TemplateDefinition = {
  ...templateMeta('corporate'),
  fonts: { body: 'plexsans', heading: 'plexsans', mono: 'jetbrainsmono' },
  render: (props) => <Corporate {...props} />,
};
