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

function Modern({ model, theme }: TemplateProps) {
  const c = model.company;
  const label: Style = {
    fontSize: 7.5,
    fontWeight: 600,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  };
  const sectionTitle: Style = sx(label, { color: theme.accentInk });

  return (
    <DocShell model={model} theme={theme} pageStyle={{ paddingTop: 46 }}>
      <View
        fixed
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          backgroundColor: theme.accent,
        }}
      />

      {/* Header: brand on the left, document title on the right */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 }}>
        <View style={{ width: '58%' }}>
          {c.logo ? (
            <Logo src={c.logo} width={160} height={48} />
          ) : (
            <Text style={{ fontSize: 17, fontWeight: 800, color: theme.ink }}>{c.name}</Text>
          )}
          <View style={{ marginTop: c.logo ? 10 : 5 }}>
            {c.logo ? (
              <Text style={{ fontSize: 9.5, fontWeight: 700, color: theme.ink, marginBottom: 2 }}>
                {c.name}
              </Text>
            ) : null}
            {c.nameSecondary ? (
              <Text style={{ fontSize: 8.5, fontWeight: 600, color: theme.body, marginBottom: 2 }}>
                {c.nameSecondary}
              </Text>
            ) : null}
            <Lines
              lines={[...c.addressLines, ...companyContactLines(model), companyIdLine(model)]}
              style={{ fontSize: 8, color: theme.muted, lineHeight: 1.4 }}
            />
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', width: '40%' }}>
          <Text
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: theme.accentInk,
              textTransform: 'uppercase',
              letterSpacing: 1,
              textAlign: 'right',
            }}
          >
            {model.title}
          </Text>
          {model.titleSecondary ? (
            <Text
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: theme.accentInk,
                textTransform: 'uppercase',
                letterSpacing: 2.4,
                marginTop: 1,
                textAlign: 'right',
              }}
            >
              {model.titleSecondary}
            </Text>
          ) : null}
          {model.number ? (
            <Text style={sx({ fontSize: 10, color: theme.muted, marginTop: 4 }, TNUM)}>
              {model.number}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Summary panel */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: theme.accentSoft,
          borderRadius: 8,
          paddingVertical: 13,
          paddingHorizontal: 16,
          marginBottom: 18,
        }}
      >
        <View style={{ flex: 1.25, paddingRight: 14 }}>
          <Label
            text={model.recipientLabel}
            secondary={model.recipientLabelSecondary}
            style={label}
          />
          <Text style={{ fontSize: 10.5, fontWeight: 700, color: theme.ink, marginBottom: 3 }}>
            {model.client.name || '—'}
          </Text>
          {model.client.nameSecondary ? (
            <Text style={{ fontSize: 8.5, fontWeight: 600, color: theme.body, marginBottom: 3 }}>
              {model.client.nameSecondary}
            </Text>
          ) : null}
          <Lines
            lines={clientLines(model, false)}
            style={{ fontSize: 8.5, color: theme.body, lineHeight: 1.5 }}
          />
        </View>
        {model.shipTo ? (
          <View style={{ flex: 1, paddingRight: 14 }}>
            <Label text={model.labels.shipTo} secondary={en(model, 'shipTo')} style={label} />
            <Text style={{ fontSize: 9, fontWeight: 700, color: theme.ink, marginBottom: 3 }}>
              {model.shipTo.name}
            </Text>
            <Lines
              lines={model.shipTo.lines}
              style={{ fontSize: 8.5, color: theme.body, lineHeight: 1.5 }}
            />
          </View>
        ) : null}
        <View style={{ flex: 1, paddingRight: 14 }}>
          {model.meta.map((m) => (
            <View key={m.label} style={{ marginBottom: 7 }}>
              <Label
                text={m.label}
                secondary={m.secondary}
                style={sx(label, { marginBottom: 2 })}
              />
              <Text style={sx({ fontSize: 9, fontWeight: 600, color: theme.ink }, TNUM)}>
                {m.value}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Label
            text={model.amountDue.label}
            secondary={model.amountDue.secondary}
            style={sx(label, { textAlign: 'right' })}
            stack
          />
          <Text
            style={sx(
              {
                fontSize: fitSize(model.amountDue.value, 19, 13),
                fontWeight: 800,
                color: theme.accentInk,
                textAlign: 'right',
              },
              TNUM,
            )}
          >
            {model.amountDue.value}
          </Text>
          {model.amountDue.caption ? (
            <Text style={{ fontSize: 8, color: theme.muted, marginTop: 4, textAlign: 'right' }}>
              {model.amountDue.caption}
            </Text>
          ) : null}
          {model.deposit ? (
            <View style={{ marginTop: 8, alignItems: 'flex-end' }}>
              <Label
                text={model.deposit.label}
                secondary={model.deposit.secondary}
                style={{ fontSize: 8, color: theme.muted, textAlign: 'right' }}
              />
              <Text style={sx({ fontSize: 10, fontWeight: 700, color: theme.ink }, TNUM)}>
                {model.deposit.value}
              </Text>
              {model.deposit.caption ? (
                <Text style={{ fontSize: 7.5, color: theme.muted }}>{model.deposit.caption}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {/* Placed before the table so it always lands on the first page. */}
      <Stamp
        model={model}
        theme={theme}
        style={{ top: model.titleSecondary ? 128 : 112, right: 46 }}
      />

      <ItemsTable
        model={model}
        theme={theme}
        styles={{
          header: { backgroundColor: theme.accent, borderRadius: 5 },
          headerText: {
            color: theme.onAccent,
            fontSize: 7.5,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          },
          row: { borderBottomWidth: 0.75, borderBottomColor: theme.line },
          headingText: { color: theme.accentInk },
        }}
      />

      <TotalsSection
        model={model}
        theme={theme}
        titleStyle={sectionTitle}
        totals={{
          width: 236,
          row: { paddingHorizontal: 10, paddingVertical: 3.5 },
          strongRow: {
            paddingHorizontal: 10,
            borderTopWidth: 0.75,
            borderTopColor: theme.line,
            marginTop: 3,
            paddingTop: 6,
          },
          grandRow: {
            backgroundColor: theme.accent,
            borderRadius: 6,
            paddingHorizontal: 10,
            paddingVertical: 8,
            marginTop: 6,
          },
          grandLabel: { color: theme.onAccent },
          grandValue: { color: theme.onAccent, fontSize: 12.5 },
          note: { paddingHorizontal: 10 },
        }}
      />

      <RunningHeader model={model} theme={theme} />
      <PageFooter model={model} theme={theme} />
    </DocShell>
  );
}

export const modern: TemplateDefinition = {
  ...templateMeta('modern'),
  fonts: { body: 'inter', heading: 'inter', mono: 'jetbrainsmono' },
  render: (props) => <Modern {...props} />,
};
