import React, {useCallback, useEffect, useState} from 'react';
import {
  FlatList,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Settings,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SyncVault, useSyncStatus} from 'react-native-sync-vault';
import {API_URL, auth} from './src/config';
import {reportResults, runScenarios, type ScenarioResult} from './src/contract/scenarios';

interface Todo {
  id: string;
  title: string;
  done: boolean;
  version?: number;
}

/** Optimistic local state; the server copy is reloaded whenever the outbox is empty. */
function useTodos() {
  const status = useSyncStatus();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const idle = status.pendingCount === 0;

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/todos`, {headers: {Authorization: `Bearer ${auth.token}`}});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTodos(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (idle) void reload();
  }, [idle, status.counts.succeeded, reload]);

  const add = async (title: string) => {
    const todo: Todo = {id: SyncVault.generateId(), title, done: false};
    setTodos(list => [...list, todo]);
    await SyncVault.enqueue({method: 'POST', url: '/todos', body: todo, queueKey: `todo:${todo.id}`});
  };

  const toggle = async (todo: Todo) => {
    setTodos(list => list.map(t => (t.id === todo.id ? {...t, done: !t.done} : t)));
    // Ordered behind the create; repeated taps coalesce into one pending PATCH.
    await SyncVault.enqueue({
      method: 'PATCH',
      url: `/todos/${todo.id}`,
      body: {done: !todo.done},
      queueKey: `todo:${todo.id}`,
      dedupeKey: `todo:${todo.id}:done`,
    });
  };

  const remove = async (todo: Todo) => {
    setTodos(list => list.filter(t => t.id !== todo.id));
    await SyncVault.enqueue({method: 'DELETE', url: `/todos/${todo.id}`, queueKey: `todo:${todo.id}`});
  };

  return {todos, error, status, add, toggle, remove, reload};
}

function TodosScreen() {
  const {todos, error, status, add, toggle, remove} = useTodos();
  const [title, setTitle] = useState('');

  return (
    <View style={styles.flex}>
      <View style={styles.statusRow}>
        <Text testID="status-online" style={styles.badge}>
          {status.isOnline ? 'online' : 'offline'}
        </Text>
        <Text testID="status-pending" style={styles.badge}>
          {`pending ${status.pendingCount}`}
        </Text>
        <Text testID="status-dead" style={styles.badge}>
          {`failed ${status.counts.deadLetter}`}
        </Text>
        <Text style={styles.badge}>{`synced ${status.counts.succeeded}`}</Text>
      </View>
      {error ? <Text style={styles.error}>{`server: ${error}`}</Text> : null}
      <View style={styles.row}>
        <TextInput
          testID="new-todo-input"
          style={styles.input}
          value={title}
          placeholder="What needs doing?"
          onChangeText={setTitle}
          onSubmitEditing={() => title.trim() && add(title.trim()).then(() => setTitle(''))}
        />
        <Pressable testID="add-todo" style={styles.button} onPress={() => title.trim() && add(title.trim()).then(() => setTitle(''))}>
          <Text style={styles.buttonText}>Add</Text>
        </Pressable>
      </View>
      <FlatList
        data={todos}
        keyExtractor={t => t.id}
        renderItem={({item}) => (
          <View style={styles.todo} testID={`todo-${item.title}`}>
            <Pressable testID={`toggle-${item.title}`} style={styles.flex} onPress={() => toggle(item)}>
              <Text style={[styles.todoText, item.done && styles.done]}>{item.title}</Text>
            </Pressable>
            <Pressable testID={`delete-${item.title}`} onPress={() => remove(item)}>
              <Text style={styles.delete}>Delete</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

function ContractScreen({autorun}: {autorun: boolean}) {
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setResults([]);
    const all = await runScenarios(result => setResults(list => [...list, result]));
    setRunning(false);
    await reportResults(all).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (autorun) void run();
  }, [autorun, run]);

  const passed = results.filter(r => r.ok).length;
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.contract}>
      <Text style={styles.hint}>Runs the native contract against the reference server (npm run server).</Text>
      <Pressable testID="run-contract" style={styles.button} disabled={running} onPress={run}>
        <Text style={styles.buttonText}>{running ? 'Running…' : 'Run native contract'}</Text>
      </Pressable>
      {results.map((r, i) => (
        <View key={r.name} style={styles.result} testID={`contract-result-${i}`}>
          <Text style={[styles.resultTitle, r.ok ? styles.pass : styles.fail]}>{`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`}</Text>
          <Text style={styles.resultDetail}>{`${r.detail} (${r.ms}ms)`}</Text>
        </View>
      ))}
      {!running && results.length > 0 ? (
        <Text testID="contract-summary" style={styles.summary}>{`${passed}/${results.length} passed`}</Text>
      ) : null}
    </ScrollView>
  );
}

/**
 * Opens the Contract tab and runs it, for headless CI runs. Android: `syncvaulttodo://contract`.
 * iOS asks before opening custom schemes, so use the `-SyncVaultContract autorun` launch argument.
 */
function useContractLink(open: () => void) {
  const [autorun, setAutorun] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'ios' && Settings.get('SyncVaultContract') === 'autorun') {
      open();
      setAutorun(true);
    }
    const handle = (url: string | null) => {
      if (url?.startsWith('syncvaulttodo://contract')) {
        open();
        setAutorun(true);
      }
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({url}) => handle(url));
    return () => sub.remove();
  }, [open]);
  return autorun;
}

export default function App() {
  const [tab, setTab] = useState<'todos' | 'contract'>('todos');
  const autorun = useContractLink(useCallback(() => setTab('contract'), []));
  return (
    <SafeAreaView style={styles.flex}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.tabs}>
        {(['todos', 'contract'] as const).map(name => (
          <Pressable key={name} testID={`tab-${name}`} style={[styles.tab, tab === name && styles.tabActive]} onPress={() => setTab(name)}>
            <Text style={styles.tabText}>{name === 'todos' ? 'Todos' : 'Contract'}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'todos' ? <TodosScreen /> : <ContractScreen autorun={autorun} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  tabs: {flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc'},
  tab: {flex: 1, padding: 12, alignItems: 'center'},
  tabActive: {borderBottomWidth: 2, borderColor: '#2563eb'},
  tabText: {fontWeight: '600'},
  statusRow: {flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 6},
  badge: {backgroundColor: '#eef2ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, fontSize: 12},
  error: {color: '#b91c1c', paddingHorizontal: 12},
  row: {flexDirection: 'row', padding: 8, gap: 8},
  input: {flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, height: 40},
  button: {backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center', height: 40, alignItems: 'center'},
  buttonText: {color: 'white', fontWeight: '600'},
  todo: {flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#eee'},
  todoText: {fontSize: 16},
  done: {textDecorationLine: 'line-through', color: '#888'},
  delete: {color: '#b91c1c'},
  contract: {padding: 12, gap: 10},
  hint: {color: '#555'},
  result: {padding: 10, borderRadius: 8, backgroundColor: '#f8fafc'},
  resultTitle: {fontWeight: '700'},
  resultDetail: {color: '#444', marginTop: 2, fontSize: 12},
  pass: {color: '#15803d'},
  fail: {color: '#b91c1c'},
  summary: {fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: 8},
});
