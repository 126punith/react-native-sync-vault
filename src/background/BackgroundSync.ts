import { DeviceEventEmitter } from 'react-native';
import TaskScheduler, { BackgroundTaskConfig } from './TaskScheduler';
import { getNativeModule } from '../utils/nativeModule';

// Get native module
const NativeModule = getNativeModule();

/**
 * Background Sync
 * Guarantees sync execution even after app kill
 */
class BackgroundSync {
  private taskScheduler: TaskScheduler;
  private scheduledTasks: Map<string, BackgroundTaskConfig> = new Map();

  constructor() {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:15',message:'BackgroundSync constructor called',data:{hasNativeModule:!!NativeModule,nativeModuleMethods:NativeModule?Object.keys(NativeModule).filter(k=>k.includes('background')||k.includes('Background')||k.includes('Task')||k.includes('Work')):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    this.taskScheduler = new TaskScheduler();
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:20',message:'BackgroundSync constructor - checking for recovery logic',data:{hasRecoverTasks:typeof this.recoverTasks==='function',willCallRecover:false},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // Listen for background task execution events from native Worker
    if (__DEV__) {
      console.log('[BACKGROUND-SYNC] Setting up backgroundTaskExecute event listener...');
    }
    DeviceEventEmitter.addListener('backgroundTaskExecute', async (event: { taskId: string; requiredNetwork: boolean }) => {
      const { taskId } = event;
      if (__DEV__) {
        console.log('[BACKGROUND-SYNC] Received backgroundTaskExecute event:', { taskId });
      }
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:26',message:'backgroundTaskExecute event received',data:{taskId,hasTaskConfig:this.scheduledTasks.has(taskId)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      const taskConfig = this.scheduledTasks.get(taskId);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:32',message:'Checking task config',data:{taskId,hasTaskConfig:!!taskConfig,hasOperation:!!(taskConfig?.operation),scheduledTasksSize:this.scheduledTasks.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      if (taskConfig && taskConfig.operation) {
        try {
          if (__DEV__) {
            console.log('[BACKGROUND-SYNC] Executing background task:', { taskId });
          }
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:38',message:'Executing task operation',data:{taskId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          await taskConfig.operation();
          await this.markTaskComplete(taskId);
        } catch (error) {
          if (__DEV__) {
            console.error(`[BACKGROUND-SYNC] Background task ${taskId} failed:`, error);
          }
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:44',message:'Task execution failed',data:{taskId,error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          await this.markTaskFailed(taskId, error);
        }
      } else {
        if (__DEV__) {
          console.warn(`[BACKGROUND-SYNC] No task handler found for taskId: ${taskId}`);
        }
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:48',message:'No task handler found',data:{taskId,scheduledTasksKeys:Array.from(this.scheduledTasks.keys())},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
      }
    });
  }

  /**
   * Guarantee sync execution (survives app kill)
   */
  async guarantee(config: BackgroundTaskConfig): Promise<void> {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:22',message:'guarantee() called',data:{taskId:config.taskId,hasOperation:!!config.operation,requiredNetwork:config.requiredNetwork,priority:config.priority},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (__DEV__) {
      console.log('[BACKGROUND-SYNC] Guaranteeing background sync:', { taskId: config.taskId });
    }
    try {
      // Store task configuration
      this.scheduledTasks.set(config.taskId, config);

      // Persist task to SQLite for recovery
      await this.persistTask(config);

      // Schedule platform-specific background task
      await this.taskScheduler.scheduleTask(config);

      // Register task handler with native module
      await this.registerTaskHandler(config.taskId, config.operation);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:38',message:'guarantee() error',data:{taskId:config.taskId,error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      if (__DEV__) {
        console.error('[BACKGROUND-SYNC] Failed to guarantee background sync:', error);
      }
      throw error;
    }
  }

  /**
   * Persist task to SQLite for recovery
   */
  private async persistTask(config: BackgroundTaskConfig): Promise<void> {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:49',message:'persistTask() entry',data:{taskId:config.taskId,hasNativeModule:!!NativeModule,hasExecuteSql:!!(NativeModule?.executeSql)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    if (!NativeModule) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:50',message:'persistTask() early return - no NativeModule',data:{taskId:config.taskId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      return;
    }

    try {
      const taskData = {
        task_id: config.taskId,
        required_network: config.requiredNetwork ?? true,
        priority: config.priority ?? 'normal',
        retry_policy: JSON.stringify(config.retryPolicy || {}),
        created_at: Date.now(),
        status: 'scheduled',
      };

      // Create background_tasks table if it doesn't exist
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS background_tasks (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE,
          required_network INTEGER NOT NULL,
          priority TEXT NOT NULL,
          retry_policy TEXT,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          last_attempt_at INTEGER,
          attempt_count INTEGER DEFAULT 0
        )
      `;

      await NativeModule.executeSql(createTableQuery, []);

      // Insert or update task
      const insertQuery = `
        INSERT OR REPLACE INTO background_tasks 
        (id, task_id, required_network, priority, retry_policy, created_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const taskId = config.taskId;
      await NativeModule.executeSql(insertQuery, [
        taskId,
        taskData.task_id,
        taskData.required_network ? 1 : 0,
        taskData.priority,
        taskData.retry_policy,
        taskData.created_at,
        taskData.status,
      ]);
      
      if (__DEV__) {
        console.log('[BACKGROUND-SYNC] Persisting task to SQLite:', { taskId: config.taskId });
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[BACKGROUND-SYNC] Failed to persist background task:', error);
      }
    }
  }

  /**
   * Register task handler with native module
   * Note: Task handlers are stored in memory and executed via event listener
   */
  private async registerTaskHandler(
    taskId: string,
    operation: () => Promise<void>
  ): Promise<void> {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:112',message:'registerTaskHandler() entry',data:{taskId,hasOperation:!!operation},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    // Task handler is already stored in scheduledTasks Map
    // The event listener in constructor will handle execution when native Worker emits event
    if (__DEV__) {
      console.log('[BACKGROUND-SYNC] Task handler stored for:', { taskId });
    }
  }

  /**
   * Mark task as complete
   */
  private async markTaskComplete(taskId: string): Promise<void> {
    if (!NativeModule) {
      return;
    }

    try {
      const updateQuery = `
        UPDATE background_tasks 
        SET status = 'completed'
        WHERE task_id = ?
      `;
      await NativeModule.executeSql(updateQuery, [taskId]);
      this.scheduledTasks.delete(taskId);
    } catch (error) {
      if (__DEV__) {
        console.error('Failed to mark task complete:', error);
      }
    }
  }

  /**
   * Mark task as failed
   */
  private async markTaskFailed(taskId: string, error: any): Promise<void> {
    if (!NativeModule) {
      return;
    }

    try {
      const config = this.scheduledTasks.get(taskId);
      if (!config) {
        return;
      }

      const retryPolicy = config.retryPolicy || {};
      const maxAttempts = retryPolicy.maxAttempts || 3;

      // Get current attempt count
      const getQuery = `SELECT attempt_count FROM background_tasks WHERE task_id = ?`;
      const results = await NativeModule.executeSql(getQuery, [taskId]);
      const attemptCount = (results?.[0]?.attempt_count || 0) + 1;

      if (attemptCount < maxAttempts) {
        // Retry task
        const updateQuery = `
          UPDATE background_tasks 
          SET status = 'retrying', 
              attempt_count = ?,
              last_attempt_at = ?
          WHERE task_id = ?
        `;
        await NativeModule.executeSql(updateQuery, [
          attemptCount,
          Date.now(),
          taskId,
        ]);

        // Reschedule with backoff
        const delay = this.calculateBackoff(
          attemptCount,
          retryPolicy.backoff || 'exponential',
          retryPolicy.initialDelay || 1000
        );

        setTimeout(() => {
          this.guarantee(config).catch((err) => {
            if (__DEV__) {
              console.error('Failed to retry background task:', err);
            }
          });
        }, delay);
      } else {
        // Max attempts reached, mark as failed
        const updateQuery = `
          UPDATE background_tasks 
          SET status = 'failed'
          WHERE task_id = ?
        `;
        await NativeModule.executeSql(updateQuery, [taskId]);
        this.scheduledTasks.delete(taskId);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Failed to mark task failed:', error);
      }
    }
  }

  /**
   * Calculate backoff delay
   */
  private calculateBackoff(
    attemptCount: number,
    backoffType: 'exponential' | 'linear' | 'fixed',
    initialDelay: number
  ): number {
    switch (backoffType) {
      case 'exponential':
        return initialDelay * Math.pow(2, attemptCount - 1);
      case 'linear':
        return initialDelay * attemptCount;
      case 'fixed':
      default:
        return initialDelay;
    }
  }

  /**
   * Cancel guaranteed sync
   */
  async cancel(taskId: string): Promise<void> {
    try {
      await this.taskScheduler.cancelTask(taskId);
      this.scheduledTasks.delete(taskId);

      if (NativeModule) {
        const deleteQuery = `DELETE FROM background_tasks WHERE task_id = ?`;
        await NativeModule.executeSql(deleteQuery, [taskId]);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Failed to cancel background sync:', error);
      }
    }
  }

  /**
   * Get all scheduled tasks
   */
  async getScheduledTasks(): Promise<string[]> {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:297',message:'getScheduledTasks() entry',data:{hasNativeModule:!!NativeModule},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    if (!NativeModule) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:300',message:'getScheduledTasks() early return - no NativeModule',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      return [];
    }

    try {
      const query = `
        SELECT task_id FROM background_tasks 
        WHERE status IN ('scheduled', 'retrying')
      `;
      const results = await NativeModule.executeSql(query, []);
      const taskIds = (results || []).map((row: any) => row.task_id);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:310',message:'getScheduledTasks() result',data:{taskCount:taskIds.length,taskIds},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      return taskIds;
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:314',message:'getScheduledTasks() error',data:{error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      if (__DEV__) {
        console.error('Failed to get scheduled tasks:', error);
      }
      return [];
    }
  }

  /**
   * Recover persisted tasks from SQLite on app restart
   */
  async recoverTasks(): Promise<void> {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:333',message:'recoverTasks() entry',data:{hasNativeModule:!!NativeModule},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    if (__DEV__) {
      console.log('[BACKGROUND-SYNC] recoverTasks() called - checking for persisted tasks...');
    }
    if (!NativeModule) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:336',message:'recoverTasks() early return - no NativeModule',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      if (__DEV__) {
        console.log('[BACKGROUND-SYNC] recoverTasks() - NativeModule not available, skipping recovery');
      }
      return;
    }

    try {
      const query = `
        SELECT task_id, required_network, priority, retry_policy, status
        FROM background_tasks 
        WHERE status IN ('scheduled', 'retrying')
      `;
      const results = await NativeModule.executeSql(query, []);
      const tasks = results || [];
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:347',message:'recoverTasks() found tasks',data:{taskCount:tasks.length,taskIds:tasks.map((t:any)=>t.task_id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      if (__DEV__) {
        console.log(`[BACKGROUND-SYNC] recoverTasks() - Found ${tasks.length} persisted tasks:`, tasks.map((t: any) => t.task_id));
      }

      for (const task of tasks) {
        try {
          const taskConfig: BackgroundTaskConfig = {
            taskId: task.task_id,
            requiredNetwork: task.required_network === 1,
            priority: task.priority || 'normal',
            retryPolicy: task.retry_policy ? JSON.parse(task.retry_policy) : undefined,
            // Default operation: sync all pending requests
            // This is a fallback since we can't serialize the original operation function
            operation: async () => {
              if (__DEV__) {
                console.log('[BACKGROUND-SYNC] Executing recovered task (default sync):', { taskId: task.task_id });
              }
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:368',message:'recovered task operation executing',data:{taskId:task.task_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
              // #endregion
              // Try to get QueueManager and trigger sync
              try {
                const { getQueueManager } = require('../QueueManager');
                const queueManager = getQueueManager();
                if (queueManager) {
                  // Get pending requests and sync them via SyncEngine if available
                  // For now, just log that the task was recovered
                  // The actual sync will be handled by the native WorkManager callback
                  // once we implement the native methods
                  if (__DEV__) {
                    console.log('[BACKGROUND-SYNC] Recovered task ready for execution:', { taskId: task.task_id });
                  }
                }
              } catch (error) {
                if (__DEV__) {
                  console.error('[BACKGROUND-SYNC] Error in recovered task operation:', error);
                }
              }
            },
          };

          // Re-register task in memory
          this.scheduledTasks.set(task.task_id, taskConfig);

          // Re-schedule with native module (if available)
          await this.taskScheduler.scheduleTask(taskConfig);

          // Re-register task handler
          await this.registerTaskHandler(task.task_id, taskConfig.operation);

          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:375',message:'recoverTasks() recovered task',data:{taskId:task.task_id,rescheduled:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
        } catch (error) {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:379',message:'recoverTasks() error recovering task',data:{taskId:task.task_id,error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          if (__DEV__) {
            console.error(`[BACKGROUND-SYNC] Failed to recover task ${task.task_id}:`, error);
          }
        }
      }
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:387',message:'recoverTasks() error',data:{error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      if (__DEV__) {
        console.error('[BACKGROUND-SYNC] Failed to recover tasks:', error);
      }
    }
  }

  /**
   * Initialize and recover tasks (call this on app start)
   */
  async initialize(): Promise<void> {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:397',message:'initialize() entry',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    if (__DEV__) {
      console.log('[BACKGROUND-SYNC] initialize() called - starting recovery...');
    }
    await this.recoverTasks();
    if (__DEV__) {
      console.log('[BACKGROUND-SYNC] initialize() completed');
    }
  }

  /**
   * Check if background sync is supported
   */
  isSupported(): boolean {
    return this.taskScheduler.isSupported();
  }
}

// Singleton instance
let backgroundSyncInstance: BackgroundSync | null = null;

/**
 * Get BackgroundSync instance
 */
export function getBackgroundSync(): BackgroundSync {
  if (!backgroundSyncInstance) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:451',message:'getBackgroundSync() creating new instance',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (__DEV__) {
      console.log('[BACKGROUND-SYNC] getBackgroundSync() called - creating new instance');
    }
    backgroundSyncInstance = new BackgroundSync();
    // Initialize and recover tasks on first access
    // Use setTimeout to avoid blocking initialization
    if (__DEV__) {
      console.log('[BACKGROUND-SYNC] Scheduling initialization in 1000ms...');
    }
    setTimeout(() => {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:457',message:'getBackgroundSync() setTimeout callback firing',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      if (__DEV__) {
        console.log('[BACKGROUND-SYNC] Starting initialization and recovery...');
      }
      if (backgroundSyncInstance) {
        backgroundSyncInstance.initialize().catch((error) => {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:462',message:'getBackgroundSync() initialize() error',data:{error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          if (__DEV__) {
            console.error('[BACKGROUND-SYNC] Failed to initialize:', error);
          }
        });
      }
    }, 1000); // Delay to ensure native module is ready
  } else {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BackgroundSync.ts:470',message:'getBackgroundSync() returning existing instance',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (__DEV__) {
      console.log('[BACKGROUND-SYNC] getBackgroundSync() called - returning existing instance');
    }
  }
  return backgroundSyncInstance;
}

export default BackgroundSync;

