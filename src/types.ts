export type EventType = 'add_todo' | 'edit_task' | 'postpone' | 'mark_done' | 'revert';

export interface TodoEvent {
  eid:        string;
  type:       EventType;
  at:         number;
  device_id:  string;
  task_id:    string;
  parent_eid: string | null;
  task?:      string;
  ms?:        number;
}

export interface Task {
  task_id:    string;
  task:       string;
  created_at: number;
  deadline:   number;
  done_at?:   number;
}

export interface TodoState {
  todo_list: Task[];
  done_list: Task[];
}
