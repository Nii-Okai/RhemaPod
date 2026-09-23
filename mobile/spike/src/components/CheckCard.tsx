import { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type CheckStatus = 'idle' | 'running' | 'pass' | 'fail';

const STATUS_LABEL: Record<CheckStatus, string> = {
  idle: 'NOT RUN',
  running: 'RUNNING…',
  pass: 'PASS',
  fail: 'FAIL',
};

const STATUS_COLOR: Record<CheckStatus, string> = {
  idle: '#6b7280',
  running: '#b45309',
  pass: '#15803d',
  fail: '#b91c1c',
};

interface Props {
  itemNumber: string;
  title: string;
  status: CheckStatus;
}

/**
 * One shared shell per plan item so the five checks read as a checklist,
 * not five differently-styled screens. `status` is set by the check itself
 * from real outcomes (a thrown error, an assertion, a measured number) —
 * never asserted from this component.
 */
export function CheckCard({ itemNumber, title, status, children }: PropsWithChildren<Props>) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.itemNumber}>Item {itemNumber}</Text>
        <Text style={[styles.status, { color: STATUS_COLOR[status] }]}>
          {STATUS_LABEL[status]}
        </Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

export function LogLine({ children }: PropsWithChildren<unknown>) {
  return <Text style={styles.logLine}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  status: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 10,
  },
  body: {
    gap: 6,
  },
  logLine: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#111827',
  },
});
