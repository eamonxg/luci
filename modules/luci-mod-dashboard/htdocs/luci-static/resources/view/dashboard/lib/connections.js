'use strict';
'require baseclass';
'require view.dashboard.lib.charts as charts';

const PAGE_SIZE = 25;

return baseclass.extend({
	render() {
		if (this.node)
			return this.node;
		this.sections = {};
		this.search = E('input', { type: 'search', 'class': 'cbi-input-text', placeholder: _('Search networks, interfaces or devices'),
			'aria-label': _('Search networks, interfaces or devices'), input: () => {
				Object.values(this.sections).forEach(section => { section.page = 0; });
				this.draw();
			} });
		this.node = E('div', { 'class': 'dashboard-connections' }, [ this.search,
			this.section('networks', _('Networks'), [ _('Network'), _('Interface'), _('Protocol'), _('Status'), _('Devices'), '' ]),
			this.section('interfaces', _('Interfaces'), [ _('Interface'), _('Network'), _('Type'), _('Status / details'), _('Devices'), '' ]),
			this.section('devices', _('Device observations'), [ _('Hostname'), _('IP addresses'), _('MAC address'), _('Network'), _('Attachment'), _('Observation'), '' ]),
			E('p', { 'class': 'dashboard-topology-message' }, _('Address and forwarding records do not prove current connectivity or Internet access.'))
		]);
		return this.node;
	},

	section(id, title, head) {
		const section = { id, head, page: 0, records: [], body: E('div', { 'class': 'dashboard-connections-table' }), range: E('span', { role: 'status' }) };
		section.previous = E('button', { type: 'button', 'class': 'cbi-button', click: () => { section.page--; this.drawSection(section); } }, _('Previous'));
		section.next = E('button', { type: 'button', 'class': 'cbi-button', click: () => { section.page++; this.drawSection(section); } }, _('Next'));
		section.pager = E('div', { 'class': 'dashboard-topology-pager' }, [ section.range, section.previous, section.next ]);
		section.node = E('section', { 'data-dashboard-section': id }, [ E('h3', {}, title), section.body, section.pager ]);
		this.sections[id] = section;
		return section.node;
	},

	locate(data) {
		if (!this.topologyEnabled)
			return '';
		return E('button', {
			type: 'button', 'class': 'cbi-button', 'data-dashboard-topology-show': '',
			'data-dashboard-network': data.network || null, 'data-dashboard-client': data.mac || null,
			'data-dashboard-access': data.access || null, 'data-dashboard-topology-group': data.group || null,
			'data-dashboard-target-tab': data.tab || 'connections'
		}, _('Show in topology'));
	},

	update(model, topologyEnabled = true) {
		this.render();
		this.topologyEnabled = topologyEnabled;
		const record = (key, values, metadata) => Object.assign({ key, values,
			search: values.filter(value => typeof(value) === 'string').join(' ').toLowerCase() }, metadata);
		this.sections.networks.records = model.groups.map(group => record(group.id, [
			group.name, group.device || '-', group.protocol || '-', group.active === true ? _('Link up') : group.active === false ? _('Link down') : _('Unknown'),
			String(new Set(group.members.map(member => member.mac)).size), this.locate({ network: group.network, group: group.id })
		], { network: group.network, group: group.id }));
		this.sections.interfaces.records = model.groups.flatMap(group => (group.access || []).map(access => record(group.id + '|' + access.id, [
			access.name, group.name, access.kind === 'wireless' ? _('Wireless') : access.kind === 'virtual' ? _('Virtual interface') : access.kind === 'unknown' ? _('Unknown') : _('Network interface'),
			access.detail, String(access.members.length), this.locate({ network: group.network, group: group.id, access: access.id })
		], { network: group.network, access: access.id, group: group.id })));
		this.sections.devices.records = [
			...model.groups.flatMap(group => group.members.map(member => ({ ...member, group: group.id, groupName: group.name }))),
			...model.unplaced
		].map(member => record(member.id, [
			member.name, member.addresses?.join(', ') || '-', member.mac, member.groupName || _('Not identified'),
			member.access ? model.groups.find(group => group.id === member.group)?.access.find(access => access.id === member.access)?.name || _('Not identified') : _('Not identified'),
			member.context, this.locate(member)
		], { network: member.network, client: member.mac, access: member.access, group: member.group }));
		this.draw();
	},

	draw() {
		for (const section of Object.values(this.sections))
			this.drawSection(section);
	},

	drawSection(section) {
		const query = this.search.value.trim().toLowerCase();
		const records = section.records.filter(record => !query || record.search.includes(query));
		section.page = Math.max(0, Math.min(section.page, Math.ceil(records.length / PAGE_SIZE) - 1));
		const start = section.page * PAGE_SIZE;
		const shown = records.slice(start, start + PAGE_SIZE);
		section.table = charts.table({ node: section.table, head: section.head, rows: shown.map(record => record.values),
			rowKeys: shown.map(record => record.key), rowAttrs: shown.map(record => ({ tabindex: '-1',
				'data-dashboard-client-row': record.client || null, 'data-dashboard-network': record.network || null })),
			emptyText: _('No matching records') });
		if (section.table.parentNode !== section.body)
			section.body.appendChild(section.table);
		section.pager.hidden = records.length <= PAGE_SIZE;
		section.previous.disabled = section.page === 0;
		section.next.disabled = start + PAGE_SIZE >= records.length;
		section.range.textContent = records.length ? _('%d–%d of %d').format(start + 1, Math.min(start + PAGE_SIZE, records.length), records.length) : '';
	},

	navigate(selection) {
		this.render();
		this.search.value = '';
		this.draw();
		const section = this.sections[selection.client ? 'devices' : selection.access || selection.interface ? 'interfaces' : selection.section || 'networks'] || this.sections.networks;
		if (!selection.client && !selection.network && !selection.access && !selection.interface)
			return section.node;
		const index = section.records.findIndex(record =>
			(!selection.client || record.client === selection.client) &&
			(!selection.network || record.network === selection.network) &&
			(!selection.access || record.access === selection.access));
		if (index < 0)
			return section.node;
		section.page = Math.floor(index / PAGE_SIZE);
		this.drawSection(section);
		return Array.from(section.table.querySelectorAll('[data-row-key]')).find(row => row.dataset.rowKey === section.records[index].key) || section.node;
	}
});
