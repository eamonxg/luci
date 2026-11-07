'use strict';
'require baseclass';
'require view.dashboard.lib.charts as charts';
'require view.dashboard.lib.topology as topology';

const PAGE_SIZE = 4;

function text(node, value) {
	value = String(value ?? '');
	if (node.textContent !== value)
		node.textContent = value;
}

function attr(node, name, value) {
	if (value == null)
		node.removeAttribute(name);
	else if (node.getAttribute(name) !== String(value))
		node.setAttribute(name, value);
}

function reconcile(parent, children) {
	const retained = new Set(children);
	for (const child of Array.from(parent.children))
		if (!retained.has(child))
			child.remove();
	children.forEach((child, index) => {
		if (parent.children[index] !== child)
			parent.insertBefore(child, parent.children[index] || null);
	});
}

return baseclass.extend({
	widgets: [ {
		id: 'network_path_preview', slot: 'charts', title: _('Network topology'), order: 5,
		detailTabs: [ 'internet', 'system', 'wifi' ]
	} ],
	dataSources: [ 'router', 'wifi' ],
	topologySource: 'connections',

	load() {
		return topology.loadConnections();
	},

	getTopologyData() {
		return this.connectionData || null;
	},

	init() {
		if (this.node)
			return;
		if (!document.querySelector('link[data-dashboard-topology-style]'))
			document.head.appendChild(E('link', {
				rel: 'stylesheet', 'data-dashboard-topology-style': '',
				href: L.resource('view/dashboard/css/network-path-preview.css') +
					(L.env.resource_version ? '?v=' + L.env.resource_version : '')
			}));
		this.nodes = new Map();
		this.pages = new Map();
		this.selection = {};
		this.upstreams = E('div', { 'class': 'dashboard-topology-upstreams' });
		this.router = E('div', { 'class': 'dashboard-topology-router' });
		this.groups = E('ul', { 'class': 'dashboard-topology-groups' });
		this.clients = E('ul', { 'class': 'dashboard-topology-clients' });
		this.empty = E('p', { 'class': 'dashboard-topology-empty' });
		this.endpoints = E('div', { 'class': 'dashboard-topology-endpoints', id: 'dashboard-topology-endpoints' }, [ this.clients, this.empty ]);
		this.tree = E('div', { 'class': 'dashboard-topology-tree' }, [ this.upstreams, this.router, this.groups, this.endpoints ]);
		this.mobile = window.matchMedia('(max-width: 900px)');
		this.mobile.addEventListener('change', () => {
			const focused = document.activeElement;
			this.updateTree();
			if (this.node.contains(focused))
				focused.focus({ preventScroll: true });
		});
		this.upstreamEmpty = E('p', { 'class': 'dashboard-topology-empty' }, _('No upstream routes reported.'));
		this.previous = E('button', { type: 'button', 'class': 'cbi-button', click: () => this.changePage(-1) }, _('Previous'));
		this.next = E('button', { type: 'button', 'class': 'cbi-button', click: () => this.changePage(1) }, _('Next'));
		this.range = E('span', { role: 'status' });
		this.pager = E('div', { 'class': 'dashboard-topology-pager' }, [ this.range, this.previous, this.next ]);
		this.status = E('div', { 'class': 'dashboard-topology-status' }, [ this.pager ]);
		this.notice = E('p', { 'class': 'dashboard-topology-message' });
		this.node = charts.card({
			title: _('Network topology'), desc: _('Reported local connections'), className: 'dashboard-topology',
			body: [
				E('div', { 'class': 'dashboard-topology-columns', 'aria-hidden': 'true' }, [
					E('span', {}, _('Upstream routes')), E('span', {}, _('This device')),
					E('span', {}, _('Networks / links')), E('span', {}, _('Endpoints / peers'))
				]),
				this.tree,
				this.status,
				E('div', { 'class': 'dashboard-topology-legend' }, [
					E('span', {}, [ E('i', { 'aria-hidden': 'true' }), _('Reported association') ]),
					E('span', {}, [ E('i', { 'class': 'logical', 'aria-hidden': 'true' }), _('Logical connection') ])
				]),
				this.notice
			]
		});
		this.node.dataset.dashboardSpan = 'full';
		this.node.dataset.dashboardOverview = 'network-topology';
		this.node.addEventListener('click', ev => {
			const group = ev.target.closest('[data-dashboard-group]');
			if (group)
				this.toggleGroup(group.dataset.dashboardGroup);
		});
		this.node.addEventListener('dashboard-topology-selection', ev => this.select(ev.detail || {}));
		this.node.addEventListener('dashboard-topology-reveal', ev => this.select(Object.assign({ tab: 'wifi' }, ev.detail)));
	},

	toggleGroup(id) {
		if (!this.model?.groups.some(group => group.id === id && group.members.length))
			return;
		this.collapsed = this.activeGroup === id && !this.collapsed;
		this.activeGroup = id;
		this.selection = {};
		this.updateTree();
	},

	findGroup(selection) {
		if (selection.client)
			return this.model?.groups.find(group => group.members.some(member =>
				member.network === selection.network && member.mac === selection.client));
		return this.model?.groups.find(group => selection.tab === 'wifi'
				? group.wifiNetworks.includes(selection.network)
				: group.tab === selection.tab && group.network === selection.network);
	},

	select(selection) {
		this.selection = selection;
		const group = this.findGroup(selection);
		if (group?.members.length) {
			this.activeGroup = group.id;
			this.collapsed = false;
			const index = group.members.findIndex(member => member.network === selection.network && member.mac === selection.client);
			if (index >= 0)
				this.pages.set(group.id, Math.floor(index / PAGE_SIZE));
		}
		this.updateTree();
	},

	changePage(delta) {
		const group = this.model?.groups.find(group => group.id === this.activeGroup);
		if (!group)
			return;
		this.pages.set(group.id, Math.max(0, Math.min(Math.ceil(group.members.length / PAGE_SIZE) - 1, (this.pages.get(group.id) || 0) + delta)));
		this.selection = {};
		this.updateTree();
	},

	getNode(key, data, live, selected = false, expandable = false) {
		live.add(key);
		let node = this.nodes.get(key);
		const interactive = expandable || !!data.tab;
		if (!node) {
			const icon = E('span', { 'class': 'dashboard-topology-icon', 'aria-hidden': 'true' });
			const name = E('span', { 'class': 'dashboard-topology-name' });
			const detail = E('span', { 'class': 'dashboard-topology-detail' });
			const toggle = E('span', { 'class': 'dashboard-topology-toggle', 'aria-hidden': 'true' });
			const label = E('span', { 'class': 'dashboard-topology-label' }, [ name, toggle ]);
			const button = E(interactive ? 'button' : 'div', { type: interactive ? 'button' : null, 'class': 'dashboard-topology-node' }, [ icon, label, detail ]);
			node = { button, icon, label, name, detail, toggle };
			this.nodes.set(key, node);
		}
		if ((node.button.tagName === 'BUTTON') !== interactive) {
			const replacement = E(interactive ? 'button' : 'div', { type: interactive ? 'button' : null, 'class': 'dashboard-topology-node' }, [ node.icon, node.label, node.detail ]);
			node.button.replaceWith(replacement);
			node.button = replacement;
		}
		node.toggle.hidden = !expandable;
		attr(node.icon, 'data-icon', data.icon);
		attr(node.button, 'data-dashboard-tab', expandable ? null : data.tab);
		attr(node.button, 'data-dashboard-group', expandable ? data.id : null);
		attr(node.button, 'aria-expanded', expandable ? String(selected) : null);
		attr(node.button, 'aria-controls', expandable ? this.endpoints.id : null);
		attr(node.button, 'data-dashboard-network', data.network);
		attr(node.button, 'data-dashboard-client', data.mac);
		attr(node.button, 'data-dashboard-section', !expandable && data.tab === 'wifi' ? (data.mac ? 'clients' : 'networks') : null);
		attr(node.button, 'data-active', data.active === false || data.relation === 'unknown' ? 'false' : null);
		attr(node.button, 'aria-current', selected ? 'true' : null);
		const description = [ data.detail, data.mac ? data.context : null ].filter(Boolean).join(' · ');
		const label = [ data.name, description ].filter(Boolean).join(' · ');
		attr(node.button, 'aria-label', expandable
			? (selected ? _('Collapse %s') : _('Expand %s')).format(label)
			: data.tab ? _('%s: go to details').format(label) : null);
		attr(node.name, 'title', data.name);
		attr(node.detail, 'title', description);
		text(node.name, data.name);
		text(node.detail, data.detail);
		return node.button;
	},

	updateTopology(snapshot) {
		this.init();
		const focused = document.activeElement;
		const restoreFocus = !!this.selection.client && this.node?.contains(focused) &&
			focused?.dataset.dashboardClient === this.selection.client && focused?.dataset.dashboardNetwork === this.selection.network;
		this.model = topology.buildModel(snapshot);
		if (this.selection.client) {
			const group = this.findGroup(this.selection);
			if (group) {
				this.activeGroup = group.id;
				this.pages.set(group.id, Math.floor(group.members.findIndex(member =>
					member.network === this.selection.network && member.mac === this.selection.client) / PAGE_SIZE));
			}
			else {
				this.selection = {};
			}
		}
		this.updateTree();
		if (restoreFocus && document.activeElement !== focused)
			Array.from(this.nodes.values()).find(node => node.button.dataset.dashboardClient === this.selection.client &&
				node.button.dataset.dashboardNetwork === this.selection.network)?.button.focus({ preventScroll: true });
	},

	updateTree() {
		const model = this.model;
		if (!model)
			return;
		const live = new Set();
		let activeIndex = model.groups.findIndex(group => group.id === this.activeGroup && group.members.length);
		if (activeIndex < 0) {
			activeIndex = model.groups.findIndex(group => group.members.length);
			this.activeGroup = model.groups[activeIndex]?.id;
			this.collapsed = false;
		}
		const group = model.groups[activeIndex];
		reconcile(this.upstreams, model.upstreams.length ? model.upstreams.map(up => this.getNode('up:' + up.id, up, live)) : [ this.upstreamEmpty ]);
		attr(this.upstreams, 'data-has-upstreams', model.upstreams.length ? 'true' : null);
		attr(this.upstreams, 'data-single', model.upstreams.length === 1 ? 'true' : null);
		reconcile(this.router, [ this.getNode('router', model.router, live, this.selection.tab === 'system') ]);
		attr(this.router, 'data-has-upstreams', model.upstreams.length ? 'true' : null);
		attr(this.router, 'data-has-groups', model.groups.length ? 'true' : null);
		attr(this.node, 'data-has-groups', model.groups.length ? 'true' : null);

		const shownGroups = model.groups;
		const page = Math.max(0, Math.min(this.pages.get(group?.id) || 0, Math.ceil((group?.members.length || 0) / PAGE_SIZE) - 1));
		if (group)
			this.pages.set(group.id, page);
		const members = !this.collapsed ? group?.members.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) || [] : [];
		const linked = members.map((member, index) => member.relation === 'observed' ? index : -1).filter(index => index >= 0);
		reconcile(this.groups, shownGroups.map(item => {
			const key = 'group:' + item.id;
			const button = this.getNode(key, Object.assign({}, item, { tab: null }), live, item === group && !this.collapsed, item.members.length > 0);
			const cached = this.nodes.get(key);
			cached.item ||= E('li', {}, button);
			attr(cached.item, 'data-has-links', item === group && linked.length ? 'true' : null);
			return cached.item;
		}));
		reconcile(this.clients, members.map(member => {
			const key = 'member:' + member.id;
			const button = this.getNode(key, member, live, member.mac === this.selection.client && member.network === this.selection.network);
			const cached = this.nodes.get(key);
			cached.item ||= E('li', {}, button);
			attr(cached.item, 'data-linked', member.relation === 'observed' ? 'true' : null);
			return cached.item;
		}));
		const join = activeIndex - (shownGroups.length - members.length) / 2;
		const first = linked.length ? Math.min(join, ...linked) : 0;
		const last = linked.length ? Math.max(join, ...linked) : 0;
		attr(this.clients, 'style', '--topology-join-start:' + first + ';--topology-join-length:' + (last - first) +
			';--topology-first-linked:' + (linked[0] || 0) + ';--topology-linked-length:' + (linked.length ? linked[linked.length - 1] - linked[0] : 0));
		attr(this.endpoints, 'data-has-links', linked.length ? 'true' : null);
		this.groups.hidden = !model.groups.length;
		this.endpoints.hidden = !group || this.collapsed;
		this.clients.hidden = !members.length;
		this.empty.hidden = !!members.length;
		text(this.empty, group?.summary || '');
		this.pager.hidden = !group || this.collapsed || group.members.length <= PAGE_SIZE;
		this.status.hidden = this.pager.hidden;
		text(this.range, group?.members.length ? _('%d–%d of %d').format(page * PAGE_SIZE + 1, Math.min((page + 1) * PAGE_SIZE, group.members.length), group.members.length) : '');
		this.previous.disabled = page === 0;
		this.next.disabled = !group || (page + 1) * PAGE_SIZE >= group.members.length;
		// Keep one set of nodes and focus state across responsive layouts.
		// On phones, expanding a network reveals its children directly below it.
		const branchParent = this.mobile.matches && group ? this.nodes.get('group:' + group.id).item : this.tree;
		if (this.endpoints.parentNode !== branchParent)
			branchParent.appendChild(this.endpoints);
		if (this.mobile.matches && group) {
			if (this.status.parentNode !== this.endpoints)
				this.endpoints.appendChild(this.status);
		}
		else if (this.status.previousElementSibling !== this.tree) {
			this.tree.after(this.status);
		}

		const notices = [];
		if (!model.interfacesAvailable)
			notices.push(_('Interface data unavailable.'));
		if (model.wifiSupported && !model.wifiAvailable)
			notices.push(_('Wireless data unavailable.'));
		text(this.notice, notices.join(' '));
		this.notice.hidden = !notices.length;
		for (const id of this.nodes.keys())
			if (!live.has(id))
				this.nodes.delete(id);
		for (const id of this.pages.keys())
			if (!model.groups.some(group => group.id === id))
				this.pages.delete(id);
	},

	render(data) {
		this.connectionData = data;
		return { charts: [ { id: 'network_path_preview', node: () => { this.init(); return this.node; } } ] };
	}
});
