import { describe, it, expect } from 'vitest';
import { canTransition, canReadWorkItem, canMutateWorkItem } from '../src/utils/workflow.js';

describe('workflow rules', () => {
  it('allows valid forward transitions', () => {
    expect(canTransition('Open', 'In Progress')).toBe(true);
    expect(canTransition('In Progress', 'In Review')).toBe(true);
    expect(canTransition('In Review', 'Resolved')).toBe(true);
  });
  it('rejects invalid transitions', () => {
    expect(canTransition('Open', 'Resolved')).toBe(false);
    expect(canTransition('Cancelled', 'In Progress')).toBe(false);
  });
  it('allows members to read only their teams', () => {
    const user = { id: 'u1', role: 'member', teamIds: ['t1'] };
    expect(canReadWorkItem(user, { teamId: 't1' })).toBe(true);
    expect(canReadWorkItem(user, { teamId: 't2' })).toBe(false);
  });
  it('limits members to items they created or are assigned to', () => {
    const user = { id: 'u1', role: 'member', teamIds: ['t1'] };
    expect(canMutateWorkItem(user, { teamId: 't1', createdBy: 'u1', assigneeId: null })).toBe(true);
    expect(canMutateWorkItem(user, { teamId: 't1', createdBy: 'u2', assigneeId: 'u1' })).toBe(true);
    expect(canMutateWorkItem(user, { teamId: 't1', createdBy: 'u2', assigneeId: 'u3' })).toBe(false);
  });
  it('lets admins read and mutate any work item', () => {
    const admin = { id: 'a1', role: 'admin', teamIds: [] };
    const item = { teamId: 'other', createdBy: 'u2', assigneeId: 'u3' };
    expect(canReadWorkItem(admin, item)).toBe(true);
    expect(canMutateWorkItem(admin, item)).toBe(true);
  });
});
