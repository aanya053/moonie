import { useEffect, useState, useSyncExternalStore } from 'react';
import { TaskStore } from '../lib/taskStore';

export function useTasks() {
  const [store] = useState(() => new TaskStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    void store.load();
    void store.loadRecurringRules();
    return () => store.cancel();
  }, [store]);

  return {
    ...state,
    refresh: () => store.load(true),
    setView: store.setView.bind(store),
    createTask: store.createTask.bind(store),
    updateTask: store.updateTask.bind(store),
    deleteTask: store.deleteTask.bind(store),
    startTask: store.startTask.bind(store),
    completeTask: store.completeTask.bind(store),
    reopenTask: store.reopenTask.bind(store),
    dropTask: store.dropTask.bind(store),
    snoozeTask: store.snoozeTask.bind(store),
    addDependency: store.addDependency.bind(store),
    removeDependency: store.removeDependency.bind(store),
    createRecurringRule: store.createRecurringRule.bind(store),
    updateRecurringRule: store.updateRecurringRule.bind(store),
    deleteRecurringRule: store.deleteRecurringRule.bind(store),
    refreshRecurringRules: store.loadRecurringRules.bind(store),
  };
}
