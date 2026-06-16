/**
 * Admin CLI — user & project management without the API.
 *   node cli.js user:add <email> <password> [role] [projects,csv]
 *   node cli.js user:list
 *   node cli.js project:add <label> <owner> <repo> [branch]
 *   node cli.js project:list
 */
import * as auth from './lib/auth.js';
import * as projects from './lib/projects.js';

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'user:add': {
      const [email, password, role = 'editor', projs = ''] = args;
      if (!email || !password) throw new Error('Usage: user:add <email> <password> [role] [projects,csv]');
      const u = auth.createUser({ email, password, role, projects: projs ? projs.split(',') : [] });
      console.log('Created user:', u); break;
    }
    case 'user:list': console.table(auth.listUsers()); break;
    case 'project:add': {
      const [label, owner, repo, branch = 'main'] = args;
      if (!owner || !repo) throw new Error('Usage: project:add <label> <owner> <repo> [branch]');
      console.log('Created project:', projects.createProject({ label, owner, repo, branch })); break;
    }
    case 'project:list': console.table(projects.listProjects()); break;
    default:
      console.log('Commands: user:add, user:list, project:add, project:list');
  }
} catch (e) { console.error('Error:', e.message); process.exit(1); }
