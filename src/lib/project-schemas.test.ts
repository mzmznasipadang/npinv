import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectForm, parseTaskForm, parseProjectFilter, parseRecordId } from './project-schemas.ts';
const values = {clientId:'1', name:' Design ', description:' Notes ', status:'planned', startDate:'', deadline:''};
test('project form normalizes text, IDs and absent dates', () => {
  assert.deepEqual(parseProjectForm(values), {ok:true, data:{clientId:1, name:'Design', description:'Notes', status:'planned', startDate:null, deadline:null}});
});
test('project form refuses invalid IDs, lengths, dates and statuses', () => {
  for (const change of [{clientId:'0'}, {clientId:'1.5'}, {clientId:'9007199254740992'}, {name:' '}, {name:'a'.repeat(201)}, {description:'a'.repeat(2001)}, {status:'archived'}, {deadline:'2026-02-30'}, {startDate:'2026-10-15', deadline:'2026-10-14'}]) {
    assert.equal(parseProjectForm({...values, ...change}).ok, false, JSON.stringify(change));
  }
  assert.equal(parseProjectForm(null).ok, false);
});
test('task form validates title, completion and dates', () => {
  assert.deepEqual(parseTaskForm({title:' Sketch ', completed:false, dueDate:''}), {ok:true, data:{title:'Sketch', completed:false, dueDate:null}});
  for (const change of [{title:''}, {title:'x'.repeat(301)}, {completed:'true'}, {dueDate:'2026-02-30'}]) {
    assert.equal(parseTaskForm({title:'Sketch', completed:false, dueDate:'', ...change}).ok, false);
  }
  assert.equal(parseTaskForm(undefined).ok, false);
});
test('record IDs and filters reject malformed or repeated relationship values', () => {
  for (const value of [undefined, [], ['1'], '0', '-1', '1.2', 'NaN', '9007199254740992']) assert.equal(parseRecordId(value), null);
  assert.equal(parseRecordId('12'), 12);
  assert.equal(parseProjectFilter({clientId:'bad'}).ok, false);
  assert.equal(parseProjectFilter({clientId:['1','2']}).ok, false);
  assert.equal(parseProjectFilter({status:['planned']}).ok, false);
  assert.deepEqual(parseProjectFilter({q:' Acme ', status:'in_progress', archived:'true', sort:'deadline', attention:'tasks', clientId:'1'}), {ok:true,data:{q:'Acme', status:'in_progress', archived:true, sort:'deadline', attention:'tasks', clientId:1}});
});
