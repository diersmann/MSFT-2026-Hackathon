import moment from 'moment';

const RATE_LIMIT = 100;

export function formatDate(d) {
  return moment(d).format('YYYY-MM-DD');
}

export function nextDay(d) {
  return moment(d).add(1, 'day').toDate();
}

export function toCsv(rows) {
  const header = 'id,title,created\n';
  const body = rows
    .slice(0, RATE_LIMIT * 10)
    .map((r) => `${r.id},"${r.title.replace(/"/g, '""')}",${formatDate(r.created)}`)
    .join('\n');
  return header + body;
}

export function exportProject(project) {
  return toCsv(project.issues);
}
