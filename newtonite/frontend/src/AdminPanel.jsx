import { useState } from 'react';
import { AlertCircle, CheckCircle2, Users } from 'lucide-react';
import { api } from './services/api.js';

const roles = ['member', 'manager', 'admin'];

function UserRow({ person, teams, isSelf, onChanged, onMessage }) {
  const id = person._id || person.id;
  const [role, setRole] = useState(person.role);
  const [teamIds, setTeamIds] = useState((person.teamIds || []).map(String));
  const [busy, setBusy] = useState(false);
  const dirty = role !== person.role || [...teamIds].sort().join() !== [...(person.teamIds || []).map(String)].sort().join();
  const toggle = (teamId) => setTeamIds(ids => ids.includes(teamId) ? ids.filter(x => x !== teamId) : [...ids, teamId]);
  async function save() {
    setBusy(true);
    try {
      if (role !== person.role) await api(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
      if ([...teamIds].sort().join() !== [...(person.teamIds || []).map(String)].sort().join()) await api(`/users/${id}/team`, { method: 'PATCH', body: JSON.stringify({ teamIds }) });
      onMessage({ type: 'ok', text: `Saved changes for ${person.name}.` });
      await onChanged();
    } catch (e) { onMessage({ type: 'error', text: e.message }); }
    finally { setBusy(false); }
  }
  return <tr>
    <td><div className="item-title">{person.name}{isSelf && ' (you)'}</div><div className="item-meta">{person.email}</div></td>
    <td><select value={role} disabled={isSelf} title={isSelf ? 'You cannot change your own role' : ''} onChange={e => setRole(e.target.value)} className="admin-select">{roles.map(r => <option key={r}>{r}</option>)}</select></td>
    <td><div className="team-checks">{teams.length === 0 ? <span className="muted">No teams yet</span> : teams.map(t => <label key={t._id} className="check"><input type="checkbox" checked={teamIds.includes(String(t._id))} onChange={() => toggle(String(t._id))} /> {t.name}</label>)}</div></td>
    <td><button className="btn primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></td>
  </tr>;
}

export default function AdminPanel({ user, teams, users, onChanged }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function createTeam(e) {
    e.preventDefault(); setBusy(true); setMessage(null);
    try {
      await api('/teams', { method: 'POST', body: JSON.stringify({ name, description }) });
      setName(''); setDescription('');
      setMessage({ type: 'ok', text: 'Team created.' });
      await onChanged();
    } catch (err) { setMessage({ type: 'error', text: err.status === 409 ? 'A team with that name already exists.' : err.message }); }
    finally { setBusy(false); }
  }

  return <>
    <div className="page-heading"><div><p className="eyebrow">ADMINISTRATION</p><h1>Teams & people</h1><p className="muted">Create teams, assign members and set roles. Changes apply the next time that person's page loads.</p></div></div>
    {message && <div className={`alert ${message.type === 'ok' ? 'success-alert' : 'error-alert'}`}>{message.type === 'ok' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}<span>{message.text}</span></div>}
    <section className="panel admin-block"><div className="panel-heading"><div><h2>Create a team</h2><p className="muted">Teams scope who can see and work on which items.</p></div></div>
      <form className="admin-form" onSubmit={createTeam}><label>Team name<input required minLength="2" maxLength="80" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Payments Support" /></label><label>Description<input maxLength="300" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" /></label><button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create team'}</button></form>
      <div className="team-chips">{teams.map(t => <span key={t._id} className="badge">{t.name}</span>)}</div>
    </section>
    <section className="panel admin-block"><div className="panel-heading"><div><h2><Users size={15} style={{ verticalAlign: '-2px' }} /> People</h2><p className="muted">Registered users start as members with no team.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Teams</th><th></th></tr></thead><tbody>
        {users.map(p => <UserRow key={`${p._id || p.id}-${p.role}-${(p.teamIds || []).join()}`} person={p} teams={teams} isSelf={String(p._id || p.id) === String(user.id)} onChanged={onChanged} onMessage={setMessage} />)}
      </tbody></table></div>
    </section>
  </>;
}
