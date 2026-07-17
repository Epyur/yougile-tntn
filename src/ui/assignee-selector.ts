export class AssigneeSelector {
  private container: HTMLElement;
  private checkboxes: Map<string, HTMLInputElement> = new Map();
  private emailInput: HTMLInputElement;
  private getUsers: () => Array<{ id: string; name: string; email: string }>;

  constructor(
    container: HTMLElement,
    label: string,
    getUsers: () => Array<{ id: string; name: string; email: string }>,
    prefillName?: string,
  ) {
    this.getUsers = getUsers;
    this.container = container;
    const labelEl = container.createEl('label', { text: label });
    labelEl.style.marginTop = '8px';

    const users = getUsers();
    const wrapper = container.createDiv();
    wrapper.style.cssText = 'max-height:180px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:4px;padding:4px 8px;margin-bottom:4px';

    for (const u of users) {
      const row = wrapper.createDiv();
      row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 0;font-size:var(--font-smaller);cursor:pointer';
      const cb = row.createEl('input', { attr: { type: 'checkbox' } });
      cb.style.cssText = 'width:14px;height:14px;margin:0;flex-shrink:0;cursor:pointer';
      cb.value = u.id;
      if (prefillName && (u.name === prefillName || u.email === prefillName)) cb.checked = true;
      this.checkboxes.set(u.id, cb);
      const span = row.createEl('span');
      span.setText(`${u.name}${u.email && u.email !== u.name ? ` (${u.email})` : ''}`);
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName !== 'INPUT') {
          cb.checked = !cb.checked;
        }
      });
    }

    const emailRow = container.createDiv();
    emailRow.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:var(--font-smaller)';
    const emailLabel = emailRow.createEl('span');
    emailLabel.setText('Или email:');
    emailLabel.style.flexShrink = '0';
    this.emailInput = emailRow.createEl('input', { attr: { type: 'text', placeholder: 'user@example.com' } });
    this.emailInput.style.cssText = 'flex:1;min-width:0';
    if (prefillName && !Array.from(this.checkboxes.values()).some(cb => cb.checked)) {
      this.emailInput.value = prefillName;
    }
  }

  getSelectedIds(): string[] {
    const ids: string[] = [];
    for (const [id, cb] of this.checkboxes) {
      if (cb.checked) ids.push(id);
    }
    const email = this.emailInput.value.trim();
    if (email) {
      const users = this.getUsers();
      const emailToId = new Map(users.map(u => [u.email || u.name || u.id, u.id]));
      const uid = emailToId.get(email);
      if (uid && !ids.includes(uid)) ids.push(uid);
    }
    return ids;
  }
}
