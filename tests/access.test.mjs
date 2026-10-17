import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccess,
  canManageLibrary,
  canManageCourse,
  canGrade,
} from '../packages/shared/access.mjs';
test('block applies to an existing member and restoration preserves membership', () => {
  assert.equal(canAccess({ member: true, userBlocked: true }), false);
  assert.equal(canAccess({ member: true, groupBlocked: true }), false);
  assert.equal(canAccess({ member: true, denied: true }), false);
  assert.equal(canAccess({ member: true }), true);
});
test('leader cannot manage another group or grade without teaching assignment', () => {
  assert.equal(
    canManageCourse({
      accessible: true,
      leaderGroupIds: ['a'],
      course: { id: 'finance-b', groupId: 'b' },
    }),
    false,
  );
  assert.equal(canGrade({ accessible: true, courseId: 'finance-a' }), false);
});
test('library publications are shared but management remains author scoped', () => {
  assert.equal(
    canManageLibrary({ accessible: true, leader: true, userId: 'alice', authorId: 'bob' }),
    false,
  );
  assert.equal(
    canManageLibrary({ accessible: true, leader: true, userId: 'alice', authorId: 'alice' }),
    true,
  );
  assert.equal(
    canManageLibrary({ accessible: true, owner: true, userId: 'owner', authorId: 'bob' }),
    true,
  );
});
test('one teacher has independent course assignments', () => {
  const rights = { accessible: true, teacherCourseIds: ['a-finance', 'b-finance'] };
  assert.equal(canGrade({ ...rights, courseId: 'b-finance' }), true);
  assert.equal(
    canGrade({ ...rights, teacherCourseIds: ['b-finance'], courseId: 'a-finance' }),
    false,
  );
  assert.equal(
    canGrade({ ...rights, teacherCourseIds: ['b-finance'], courseId: 'b-finance' }),
    true,
  );
});
test('blocked owner is denied and nonmember is denied', () => {
  assert.equal(canAccess({ owner: true, userBlocked: true }), false);
  assert.equal(canAccess({}), false);
});
