/**
 * Todo App Example
 * 
 * Demonstrates offline-first todo management with react-native-sync-vault
 */

import React from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  Alert,
} from 'react-native';
import { useOfflineQueue, useQueueStatus, useFailedRequests } from 'react-native-sync-vault';

const API_BASE_URL = 'https://jsonplaceholder.typicode.com'; // Demo API

interface Todo {
  id: number;
  title: string;
  completed: boolean;
}

export default function TodoApp() {
  // Initialize offline queue with automatic interception
  const queue = useOfflineQueue({
    baseUrl: API_BASE_URL,
    interceptor: {
      enabled: true,
      urlFilter: [API_BASE_URL],
    },
  });

  const { status } = useQueueStatus();
  const { failedRequests, retry } = useFailedRequests();

  const [todos, setTodos] = React.useState<Todo[]>([]);
  const [newTodo, setNewTodo] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  // Load todos on mount
  React.useEffect(() => {
    loadTodos();
  }, []);

  const loadTodos = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/todos?_limit=10`);
      if (response.ok) {
        const data = await response.json();
        setTodos(data);
      }
    } catch (error) {
      console.error('Failed to load todos:', error);
    } finally {
      setLoading(false);
    }
  };

  const createTodo = async () => {
    if (!newTodo.trim()) return;

    const todoText = newTodo.trim();
    setNewTodo('');

    try {
      const response = await fetch(`${API_BASE_URL}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: todoText,
          completed: false,
          userId: 1,
        }),
      });

      if (response.status === 202) {
        // Request was queued (offline)
        Alert.alert('Queued', 'Todo will be created when online');
      } else if (response.ok) {
        // Request succeeded
        const data = await response.json();
        setTodos([...todos, data]);
        Alert.alert('Success', 'Todo created');
      }
    } catch (error) {
      console.error('Failed to create todo:', error);
      Alert.alert('Error', 'Failed to create todo');
    }
  };

  const toggleTodo = async (todo: Todo) => {
    try {
      const response = await fetch(`${API_BASE_URL}/todos/${todo.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          completed: !todo.completed,
        }),
      });

      if (response.status === 202) {
        // Queued - update optimistically
        setTodos(
          todos.map((t) =>
            t.id === todo.id ? { ...t, completed: !t.completed } : t
          )
        );
      } else if (response.ok) {
        const data = await response.json();
        setTodos(
          todos.map((t) => (t.id === todo.id ? data : t))
        );
      }
    } catch (error) {
      console.error('Failed to toggle todo:', error);
    }
  };

  const deleteTodo = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/todos/${id}`, {
        method: 'DELETE',
      });

      if (response.status === 202) {
        // Queued - remove optimistically
        setTodos(todos.filter((t) => t.id !== id));
        Alert.alert('Queued', 'Todo will be deleted when online');
      } else if (response.ok || response.status === 204) {
        setTodos(todos.filter((t) => t.id !== id));
        Alert.alert('Success', 'Todo deleted');
      }
    } catch (error) {
      console.error('Failed to delete todo:', error);
      Alert.alert('Error', 'Failed to delete todo');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Todo App (Offline-First)</Text>
        
        {/* Queue Status */}
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            Network: {status?.networkStatus || 'unknown'}
          </Text>
          <Text style={styles.statusText}>
            Pending: {status?.totalPending || 0}
          </Text>
          {status?.totalFailed > 0 && (
            <Text style={[styles.statusText, styles.errorText]}>
              Failed: {status.totalFailed}
            </Text>
          )}
        </View>

        {/* Failed Requests */}
        {failedRequests.length > 0 && (
          <View style={styles.failedContainer}>
            <Text style={styles.failedTitle}>Failed Requests:</Text>
            {failedRequests.map((failed) => (
              <View key={failed.id} style={styles.failedItem}>
                <Text style={styles.failedText}>{failed.errorMessage}</Text>
                <Button
                  title="Retry"
                  onPress={() => retry(failed.requestId)}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Create Todo */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Enter todo..."
          value={newTodo}
          onChangeText={setNewTodo}
          onSubmitEditing={createTodo}
        />
        <Button title="Add Todo" onPress={createTodo} />
      </View>

      {/* Todo List */}
      {loading ? (
        <Text style={styles.loading}>Loading todos...</Text>
      ) : (
        <FlatList
          data={todos}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.todoItem}>
              <Text
                style={[
                  styles.todoText,
                  item.completed && styles.todoCompleted,
                ]}
                onPress={() => toggleTodo(item)}
              >
                {item.completed ? '✓' : '○'} {item.title}
              </Text>
              <Button
                title="Delete"
                onPress={() => deleteTodo(item.id)}
                color="#ff4444"
              />
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No todos yet. Create one above!</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  statusContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  statusText: {
    fontSize: 12,
    color: '#666',
    backgroundColor: '#f0f0f0',
    padding: 4,
    borderRadius: 4,
  },
  errorText: {
    color: '#ff4444',
    backgroundColor: '#ffe0e0',
  },
  failedContainer: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#fff3cd',
    borderRadius: 4,
  },
  failedTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  failedItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  failedText: {
    fontSize: 11,
    flex: 1,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    marginRight: 8,
  },
  todoItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  todoText: {
    flex: 1,
    fontSize: 16,
  },
  todoCompleted: {
    textDecorationLine: 'line-through',
    color: '#999',
  },
  loading: {
    textAlign: 'center',
    padding: 20,
    color: '#666',
  },
  empty: {
    textAlign: 'center',
    padding: 40,
    color: '#999',
    fontSize: 16,
  },
});

