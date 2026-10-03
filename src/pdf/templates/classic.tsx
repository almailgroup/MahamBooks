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
  PaymentInfo,
  RunningHeader,
  SignatureBlock,
  Stamp,
  TNUM,
  TotalsTable,
  clientLines,
  companyContactLines,
  companyIdLine,
  en,
  fitSize,
  sx,
} from './shared';
import { templateMeta } from '../template-meta';
import type { TemplateDefinition, TemplateProps } from './types';

const BORDER = '#cbd5e1';
const HEAD = '#f1f5f9';

function Classic({ model, theme }: TemplateProps) {
  const c = model.company;
  const stripLabel: Style = {
    fontSize: 7.5,
    fontWeight: 700,
    color: theme.ink,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    backgroundColor: HEAD,
    borderBottomWidth: 0.75,
    borderBottomColor: BORDER,
    paddingVertical: 4,
    paddingHorizontal: 8,
  };
  const box: Style = { borderWidth: 0.75, borderColor: BORDER };
  const metaRows = [
    ...(model.number
      ? [{ label: model.numberLabel, secondary: model.numberLabelSecondary, value: model.number }]
      : []),
    ...model.meta,
  ];

  return (
    <DocShell model={model} theme={theme} pageStyle={{ paddingTop: 40 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
        <View style={{ width: '52%' }}>
          {c.logo ? <Logo src={c.logo} width={160} height={48} /> : null}
          <Text
            style={{
              fontSize: c.logo ? 10 : 16,
              fontWeight: 700,
              color: theme.ink,
              marginTop: c.logo ? 8 : 0,
            }}
          >
            {c.name}
          </Text>
          {c.nameSecondary ? (
            <Text
              style={{
                fontSize: c.logo ? 8.5 : 10,
                fontWeight: 600,
                color: theme.ink,
                marginTop: 1,
              }}
            >
              {c.nameSecondary}
            </Text>
          ) : null}
          <Lines
            lines={[...c.addressLines, ...companyContactLines(model), companyIdLine(model)]}
            style={{ fontSize: 8, color: theme.body, lineHeight: 1.45, marginTop: 2 }}
          />
        </View>
        <View style={{ width: 215, alignItems: 'flex-end' }}>
          <Text
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: theme.accentInk,
              textTransform: 'uppercase',
              letterSpacing: 2,
              marginBottom: model.titleSecondary ? 1 : 8,
            }}
          >
            {model.title}
          </Text>
          {model.titleSecondary ? (
            <Text
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: theme.accentInk,
                textTransform: 'uppercase',
                letterSpacing: 2,
                marginBottom: 8,
              }}
            >
              {model.titleSecondary}
            </Text>
          ) : null}
          <View style={sx(box, { width: '100%' })}>
            {metaRows.map((m, i) => (
              <View
                key={m.label}
                style={{
                  flexDirection: 'row',
                  borderTopWidth: i === 0 ? 0 : 0.75,
                  borderTopColor: BORDER,
                }}
              >
                <Label
                  text={m.label}
                  secondary={m.secondary}
                  style={{
                    width: 92,
                    fontSize: 8,
                    fontWeight: 600,
                    color: theme.body,
                    backgroundColor: HEAD,
                    paddingVertical: 4,
                    paddingHorizontal: 7,
                    borderRightWidth: 0.75,
                    borderRightColor: BORDER,
                  }}
                  secondaryStyle={{ fontWeight: 400 }}
                  stack
                />
                <Text
                  style={sx(
                    {
                      flex: 1,
                      fontSize: 8.5,
                      color: theme.ink,
                      paddingVertical: 4,
                      paddingHorizontal: 7,
                      textAlign: 'right',
                    },
                    TNUM,
                  )}
                >
                  {m.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 18 }}>
        <View style={sx(box, { flex: 1, marginRight: model.shipTo ? 10 : 0 })}>
          <Label
            text={model.recipientLabel}
            secondary={model.recipientLabelSecondary}
            style={stripLabel}
          />
          <Party
            style={{ padding: 8 }}
            name={model.client.name}
            nameSecondary={model.client.nameSecondary}
            lines={clientLines(model)}
            nameStyle={{ fontSize: 9.5, color: theme.ink }}
            linesStyle={{ fontSize: 8, color: theme.body, lineHeight: 1.45 }}
          />
        </View>
        {model.shipTo ? (
          <View style={sx(box, { flex: 1 })}>
            <Label text={model.labels.shipTo} secondary={en(model, 'shipTo')} style={stripLabel} />
            <Party
              style={{ padding: 8 }}
              name={model.shipTo.name}
              lines={model.shipTo.lines}
              nameStyle={{ fontSize: 9.5, color: theme.ink }}
              linesStyle={{ fontSize: 8, color: theme.body, lineHeight: 1.45 }}
            />
          </View>
        ) : null}
        {!model.shipTo ? (
          <View
            style={{
              width: 215,
              marginLeft: 10,
              ...box,
              justifyContent: 'center',
              alignItems: 'center',
              padding: 10,
            }}
          >
            <Label
              text={model.amountDue.label}
              secondary={model.amountDue.secondary}
              style={{
                fontSize: 7.5,
                fontWeight: 700,
                color: theme.muted,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                textAlign: 'center',
              }}
              stack
            />
            <Text
              style={sx(
                {
                  fontSize: fitSize(model.amountDue.value, 18, 17),
                  fontWeight: 700,
                  color: theme.ink,
                  marginTop: 4,
                },
                TNUM,
              )}
            >
              {model.amountDue.value}
            </Text>
            {model.amountDue.caption ? (
              <Text style={{ fontSize: 7.5, color: theme.muted, marginTop: 3 }}>
                {model.amountDue.caption}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Placed before the table so it always lands on the first page. */}
      <Stamp model={model} theme={theme} style={{ top: 175, right: 250 }} />

      <ItemsTable
        model={model}
        theme={theme}
        styles={{
          container: box,
          header: { backgroundColor: HEAD, borderBottomWidth: 0.75, borderBottomColor: BORDER },
          headerText: {
            color: theme.ink,
            fontSize: 7.5,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          },
          row: { borderTopWidth: 0.75, borderTopColor: '#e2e8f0', paddingVertical: 6 },
          columnLines: BORDER,
          headingRow: { borderTopWidth: 0.75, borderTopColor: BORDER, backgroundColor: '#fafafa' },
        }}
      />

      <View wrap={false} style={{ flexDirection: 'row', marginTop: 14 }}>
        <View style={{ flex: 1, paddingRight: 16 }}>
          {model.payment ? (
            <View style={sx(box)}>
              <Label
                text={model.labels.paymentDetails}
                secondary={en(model, 'paymentDetails')}
                style={stripLabel}
              />
              <View style={{ padding: 8 }}>
                <PaymentInfo model={model} theme={theme} showTitle={false} />
              </View>
            </View>
          ) : null}
        </View>
        <TotalsTable
          model={model}
          theme={theme}
          styles={{
            width: 215,
            container: box,
            row: {
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderBottomWidth: 0.75,
              borderBottomColor: '#e2e8f0',
            },
            label: { color: theme.body },
            strongRow: {
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderBottomWidth: 0.75,
              borderBottomColor: '#e2e8f0',
            },
            grandRow: { paddingHorizontal: 8, paddingVertical: 7, backgroundColor: HEAD },
            grandValue: { fontSize: 12 },
            note: { paddingHorizontal: 8 },
          }}
        />
      </View>

      {model.notes || model.terms ? (
        <View
          wrap={model.notes.length + model.terms.length > 900}
          style={{ flexDirection: 'row', marginTop: 14 }}
        >
          {model.notes ? (
            <View style={sx(box, { flex: 1, marginRight: model.terms ? 10 : 0 })}>
              <Label text={model.labels.notes} secondary={en(model, 'notes')} style={stripLabel} />
              <Text style={{ fontSize: 8.5, color: theme.body, lineHeight: 1.5, padding: 8 }}>
                {model.notes}
              </Text>
            </View>
          ) : null}
          {model.terms ? (
            <View style={sx(box, { flex: 1 })}>
              <Label text={model.labels.terms} secondary={en(model, 'terms')} style={stripLabel} />
              <Text style={{ fontSize: 8, color: theme.muted, lineHeight: 1.5, padding: 8 }}>
                {model.terms}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <SignatureBlock
        model={model}
        theme={theme}
        lineColor={BORDER}
        labelStyle={{
          fontSize: 7.5,
          fontWeight: 700,
          color: theme.ink,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      />

      <View
        fixed
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          backgroundColor: theme.accent,
        }}
      />
      <RunningHeader model={model} theme={theme} />
      <PageFooter model={model} theme={theme} />
    </DocShell>
  );
}

export const classic: TemplateDefinition = {
  ...templateMeta('classic'),
  fonts: { body: 'inter', heading: 'inter', mono: 'jetbrainsmono' },
  render: (props) => <Classic {...props} />,
};
