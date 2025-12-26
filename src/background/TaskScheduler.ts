import { Platform } from 'react-native';
import { getNativeModule } from '../utils/nativeModule';

// Get native module
const NativeModule = getNativeModule();

/**
 * Background task configuration
 */
export interface BackgroundTaskConfig {
  taskId: string;
  operation: () => Promise<void>;
  requiredNetwork?: boolean;
  priority?: 'high' | 'normal' | 'low';
  retryPolicy?: {
    maxAttempts?: number;
    backoff?: 'exponential' | 'linear' | 'fixed';
    initialDelay?: number; // milliseconds
  };
}

/**
 * Task Scheduler
 * Platform-specific task scheduling for background sync
 */
class TaskScheduler {
  /**
   * Schedule a background task
   */
  async scheduleTask(config: BackgroundTaskConfig): Promise<void> {
    if (__DEV__) {
      console.log('[BACKGROUND-SYNC] Scheduling task:', { 
        platform: Platform.OS, 
        taskId: config.taskId 
      });
    }
    try {
      if (Platform.OS === 'ios') {
        await this.scheduleIOSTask(config);
      } else if (Platform.OS === 'android') {
        await this.scheduleAndroidTask(config);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[BACKGROUND-SYNC] Failed to schedule background task:', error);
      }
      throw error;
    }
  }

  /**
   * Schedule iOS background task (BGTaskScheduler)
   */
  private async scheduleIOSTask(config: BackgroundTaskConfig): Promise<void> {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TaskScheduler.ts:54',message:'scheduleIOSTask() entry',data:{taskId:config.taskId,hasNativeModule:!!NativeModule,hasScheduleBackgroundTask:!!(NativeModule?.scheduleBackgroundTask)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    if (!NativeModule || !NativeModule.scheduleBackgroundTask) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TaskScheduler.ts:55',message:'scheduleIOSTask() early return - method missing',data:{taskId:config.taskId,hasNativeModule:!!NativeModule,hasScheduleBackgroundTask:!!(NativeModule?.scheduleBackgroundTask)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      return;
    }

    try {
      await NativeModule.scheduleBackgroundTask({
        taskId: config.taskId,
        requiredNetwork: config.requiredNetwork ?? true,
        priority: config.priority ?? 'normal',
      });
      
      if (__DEV__) {
        console.log('[BACKGROUND-SYNC] iOS: Registering BGTask:', { taskId: config.taskId });
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[BACKGROUND-SYNC] Failed to schedule iOS background task:', error);
      }
      throw error;
    }
  }

  /**
   * Schedule Android background task (WorkManager)
   */
  private async scheduleAndroidTask(config: BackgroundTaskConfig): Promise<void> {
    // #region agent log
    if (__DEV__) {
      console.log('[BACKGROUND-SYNC-DEBUG] scheduleAndroidTask() entry:', {
        taskId: config.taskId,
        hasNativeModule: !!NativeModule,
        hasScheduleBackgroundWork: !!(NativeModule?.scheduleBackgroundWork),
        nativeModuleKeys: NativeModule ? Object.keys(NativeModule).filter(k => k.toLowerCase().includes('background') || k.toLowerCase().includes('work') || k.toLowerCase().includes('task')) : [],
      });
    }
    fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TaskScheduler.ts:80',message:'scheduleAndroidTask() entry',data:{taskId:config.taskId,hasNativeModule:!!NativeModule,hasScheduleBackgroundWork:!!(NativeModule?.scheduleBackgroundWork)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    if (!NativeModule || !NativeModule.scheduleBackgroundWork) {
      // #region agent log
      if (__DEV__) {
        console.warn('[BACKGROUND-SYNC-DEBUG] scheduleAndroidTask() early return - method missing:', {
          taskId: config.taskId,
          hasNativeModule: !!NativeModule,
          hasScheduleBackgroundWork: !!(NativeModule?.scheduleBackgroundWork),
        });
      }
      fetch('http://127.0.0.1:7243/ingest/701063f6-e5af-4ac9-b7d5-eccc9862e27d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TaskScheduler.ts:81',message:'scheduleAndroidTask() early return - method missing',data:{taskId:config.taskId,hasNativeModule:!!NativeModule,hasScheduleBackgroundWork:!!(NativeModule?.scheduleBackgroundWork)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      return;
    }

    try {
      await NativeModule.scheduleBackgroundWork({
        taskId: config.taskId,
        requiredNetwork: config.requiredNetwork ?? true,
        priority: config.priority ?? 'normal',
        retryPolicy: config.retryPolicy,
      });
      
      if (__DEV__) {
        console.log('[BACKGROUND-SYNC] Android: Enqueuing WorkRequest:', { taskId: config.taskId });
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[BACKGROUND-SYNC] Failed to schedule Android background work:', error);
      }
      throw error;
    }
  }

  /**
   * Cancel a scheduled task
   */
  async cancelTask(taskId: string): Promise<void> {
    try {
      if (Platform.OS === 'ios') {
        if (NativeModule && NativeModule.cancelBackgroundTask) {
          await NativeModule.cancelBackgroundTask(taskId);
        }
      } else if (Platform.OS === 'android') {
        if (NativeModule && NativeModule.cancelBackgroundWork) {
          await NativeModule.cancelBackgroundWork(taskId);
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Failed to cancel background task:', error);
      }
    }
  }

  /**
   * Check if background tasks are supported
   */
  isSupported(): boolean {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  }
}

export default TaskScheduler;

