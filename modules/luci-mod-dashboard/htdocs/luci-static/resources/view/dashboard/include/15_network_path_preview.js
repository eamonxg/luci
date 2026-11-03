'use strict';
'require baseclass';
'require view.dashboard.lib.charts as charts';
'require view.dashboard.lib.topology as topology';

const PAGE_SIZE = 6;
const MAX_CLIENTS = 64;
const MAX_NETWORKS = 32;

function text(node, value) {
	value = String(value ?? '');
	if (node.textContent !== value)
		node.textContent = value;
}

function attr(node, name, value) {
	if (value == null) {
		if (node.hasAttribute(name))
			node.removeAttribute(name);
	}
	else if (node.getAttribute(name) !== String(value)) {
		node.setAttribute(name, value);
	}
}

function reconcile(parent, children) {
	const retained = new Set(children);
	for (const child of Array.from(parent.children))
		if (!retained.has(child))
			child.remove();
	children.forEach((child, i) => {
		if (parent.children[i] !== child)
			parent.insertBefore(child, parent.children[i] || null);
	});
}

return baseclass.extend({
	// Preserve the widget id already stored in saved dashboard layouts.
	widgets: [ { id: 'network_path_preview', slot: 'charts', title: _('Network topology'), order: 5 } ],
	dataSources: [ 'router', 'wifi' ],

	init() {
		if (this.node)
			return;
		if (!document.querySelector('link[data-dashboard-topology-style]'))
			document.head.appendChild(E('link', {
				rel: 'stylesheet', 'data-dashboard-topology-style': '',
				href: L.resource('view/dashboard/css/network-path-preview.css')
			}));
		this.nodes = new Map();
		this.branches = new Map();
		this.selection = {};
		this.networkLimit = 8;
		this.upstreams = E('div', { 'class': 'dashboard-topology-upstreams' });
		this.router = E('div', { 'class': 'dashboard-topology-router' });
		this.networks = E('ul', { 'class': 'dashboard-topology-networks' });
		this.message = E('div', { 'class': 'dashboard-topology-message' });
		this.moreNetworks = E('button', {
			type: 'button', 'class': 'dashboard-topology-link', hidden: true,
			click: () => {
				if (this.networkLimit >= MAX_NETWORKS)
					return;
				this.networkLimit = Math.min(MAX_NETWORKS, this.networkLimit + 8);
				this.updateTree();
				if (this.moreNetworks.hidden)
					this.networks.querySelector('button')?.focus({ preventScroll: true });
			}
		});
		this.leases = E('button', {
			type: 'button', 'class': 'dashboard-topology-link', 'data-dashboard-tab': 'dhcp'
		}, _('DHCP leases'));
		this.node = charts.card({
			title: E('span', { 'class': 'dashboard-topology-heading' }, [
				E('span', {}, _('Network topology')), this.leases
			]),
			className: 'dashboard-topology',
			body: [
				E('div', { 'class': 'dashboard-topology-columns', 'aria-hidden': 'true' }, [
					E('span', {}, _('Upstream')), E('span', {}, _('This router')),
					E('span', {}, _('Wireless networks and clients'))
				]),
				E('div', { 'class': 'dashboard-topology-tree' }, [ this.upstreams, this.router, this.networks ]),
				this.message, this.moreNetworks
			]
		});
		this.node.dataset.dashboardSpan = 'full';
		this.node.dataset.dashboardOverview = 'network-topology';
		this.node.addEventListener('dashboard-topology-selection', ev => {
			this.selection = ev.detail || {};
			this.highlight();
		});
		this.node.addEventListener('dashboard-topology-reveal', ev => {
			const { network, client } = ev.detail || {};
			const index = this.model?.networks.findIndex(net => net.id === network) ?? -1;
			if (index < 0)
				return;
			this.revealed = { network, client };
			this.networkLimit = Math.min(MAX_NETWORKS, Math.max(this.networkLimit, index + 1));
			const branch = this.branches.get(network);
			if (branch)
				branch.collapsed = false;
			this.updateTree();
		});
	},

	getNode(key, data, live) {
		live.add(key);
		let node = this.nodes.get(key);
		if (!node) {
			const icon = E('span', { 'class': 'dashboard-topology-icon', 'aria-hidden': 'true' });
			const name = E('span', { 'class': 'dashboard-topology-name' });
			const detail = E('span', { 'class': 'dashboard-topology-detail' });
			const button = E('button', { type: 'button', 'class': 'dashboard-topology-node' }, [ icon, name, detail ]);
			node = { button, icon, name, detail };
			this.nodes.set(key, node);
		}
		attr(node.icon, 'data-icon', data.icon);
		attr(node.button, 'data-dashboard-tab', data.tab);
		attr(node.button, 'data-dashboard-network', data.network);
		attr(node.button, 'data-dashboard-client', data.mac);
		attr(node.button, 'data-dashboard-section', data.tab === 'wifi' ? 'clients' : null);
		attr(node.button, 'aria-label', _('%s: go to details').format(data.name));
		attr(node.name, 'title', data.name);
		attr(node.detail, 'title', data.detail);
		text(node.name, data.name);
		text(node.detail, data.detail);
		return node.button;
	},

	getBranch(id) {
		let branch = this.branches.get(id);
		if (!branch) {
			branch = { limit: PAGE_SIZE, collapsed: false };
			branch.group = E('div', { 'class': 'dashboard-topology-group' });
			branch.clients = E('ul', { 'class': 'dashboard-topology-clients' });
			branch.toggle = E('button', {
				type: 'button', 'class': 'dashboard-topology-toggle',
				click: () => {
					if (this.revealed?.network === id)
						this.revealed = null;
					branch.collapsed = !branch.collapsed;
					this.updateTree();
				}
			});
			branch.more = E('button', {
				type: 'button', 'class': 'dashboard-topology-link',
				click: () => {
					if (branch.more.hasAttribute('data-dashboard-tab'))
						return;
					branch.collapsed = false;
					branch.limit = Math.min(MAX_CLIENTS, branch.limit + PAGE_SIZE);
					this.updateTree();
					if (!branch.more.isConnected)
						branch.toggle.focus({ preventScroll: true });
				}
			});
			branch.moreItem = E('li', { 'class': 'dashboard-topology-leaf dashboard-topology-more' }, branch.more);
			branch.emptyItem = E('li', { 'class': 'dashboard-topology-leaf dashboard-topology-empty' }, _('No clients'));
			branch.item = E('li', { 'class': 'dashboard-topology-branch' }, [ branch.group, branch.clients ]);
			this.branches.set(id, branch);
		}
		return branch;
	},

	updateTopology(snapshot) {
		this.init();
		this.model = topology.buildModel(snapshot);
		if (!this.model.networks.some(net => net.id === this.revealed?.network &&
			net.clients.some(client => client.mac === this.revealed.client)))
			this.revealed = null;
		this.updateTree();
	},

	updateTree() {
		const model = this.model;
		if (!model)
			return;
		const live = new Set();
		const upstreams = model.upstreams.slice(0, 4);
		reconcile(this.upstreams, (upstreams.length ? upstreams : [ {
			id: 'unknown', name: _('Upstream'), detail: _('No gateway reported')
		} ]).map(up => this.getNode('up:' + up.id, {
			name: up.name, detail: up.detail, icon: 'internet', tab: 'internet'
		}, live)));
		reconcile(this.router, [ this.getNode('router', {
			name: model.router.name, detail: model.router.detail, icon: 'router', tab: 'system'
		}, live) ]);

		let remaining = MAX_CLIENTS;
		let rows = 0;
		const visibleNetworks = model.networks.slice(0, this.networkLimit);
		const revealedNetwork = model.networks.find(net => net.id === this.revealed?.network);
		if (revealedNetwork && !visibleNetworks.includes(revealedNetwork))
			visibleNetworks[visibleNetworks.length - 1] = revealedNetwork;
		// Reserve space for an explicitly requested client beyond ordinary pages.
		let reserved = !!revealedNetwork;
		const branchNodes = visibleNetworks.map((net, index) => {
			const branch = this.getBranch(net.id);
			if (net === revealedNetwork)
				branch.collapsed = false;
			const group = this.getNode('net:' + net.id, {
				name: net.name, detail: net.detail, icon: 'wireless', tab: 'wifi', network: net.id
			}, live);
			attr(branch.item, 'data-network', net.id);
			attr(group, 'data-active', net.active ? 'true' : 'false');
			text(branch.toggle, branch.collapsed ? '+' : '−');
			attr(branch.toggle, 'aria-expanded', String(!branch.collapsed));
			attr(branch.toggle, 'aria-label', (branch.collapsed ? _('Expand %s') : _('Collapse %s')).format(net.name));
			branch.toggle.hidden = !net.clients.length;
			reconcile(branch.group, [ group, branch.toggle ]);

			if (net === revealedNetwork)
				reserved = false;
			const budget = Math.max(0, remaining - (reserved ? 1 : 0));
			const capacity = branch.collapsed ? 0 : Math.min(branch.limit, budget);
			const shown = net.clients.slice(0, capacity);
			const revealed = net.clients.find(client => client.mac === this.revealed?.client && net.id === this.revealed?.network);
			if (revealed && !shown.includes(revealed)) {
				if (shown.length)
					shown[shown.length - 1] = revealed;
				else if (budget > 0)
					shown.push(revealed);
			}
			remaining -= shown.length;
			const items = shown.map(client => {
				const key = 'client:' + client.id;
				const button = this.getNode(key, {
					name: client.name, detail: client.detail, icon: client.icon || 'device', tab: 'wifi',
					network: net.id, mac: client.mac
				}, live);
				const node = this.nodes.get(key);
				node.item ||= E('li', { 'class': 'dashboard-topology-leaf' }, button);
				return node.item;
			});
			if (shown.length < net.clients.length) {
				const count = net.clients.length - shown.length;
				const canExpand = (branch.collapsed || branch.limit < MAX_CLIENTS) && budget > shown.length;
				text(branch.more, canExpand ? _('Show %d more').format(Math.min(PAGE_SIZE, count)) : _('View all %d clients').format(net.clients.length));
				attr(branch.more, 'data-dashboard-tab', canExpand ? null : 'wifi');
				attr(branch.more, 'data-dashboard-network', canExpand ? null : net.id);
				attr(branch.more, 'data-dashboard-section', canExpand ? null : 'clients');
				items.push(branch.moreItem);
			}
			else if (!items.length) {
				items.push(branch.emptyItem);
			}
			// Fixed-height slots provide connector geometry without reading layout.
			branch.rowStart = rows;
			branch.rowCount = items.length;
			branch.index = index;
			branch.visibleClients = shown.map(client => client.mac);
			rows += items.length;
			reconcile(branch.clients, items);
			return branch.item;
		});
		this.rowCount = rows;
		reconcile(this.networks, branchNodes);
		this.networks.hidden = !model.networks.length;
		attr(this.router, 'data-has-networks', model.networks.length ? 'true' : null);
		this.message.hidden = !!model.networks.length;
		text(this.message, model.wifiAvailable ? _('No wireless access points reported.') : _('Wireless data unavailable.'));
		const hidden = model.networks.length - visibleNetworks.length;
		this.moreNetworks.hidden = hidden <= 0;
		text(this.moreNetworks, this.networkLimit < MAX_NETWORKS ? _('Show %d more networks').format(Math.min(8, hidden)) : _('View all wireless networks'));
		attr(this.moreNetworks, 'data-dashboard-tab', this.networkLimit < MAX_NETWORKS ? null : 'wifi');

		for (const key of this.nodes.keys())
			if (!live.has(key))
				this.nodes.delete(key);
		for (const key of this.branches.keys())
			if (!visibleNetworks.some(net => net.id === key))
				this.branches.delete(key);
		this.highlight();
	},

	highlight() {
		const { tab, network, client } = this.selection;
		const selectedBranch = tab === 'wifi' && network ? this.branches.get(network) : null;
		for (const node of this.nodes.values()) {
			const button = node.button;
			const onNetwork = !!selectedBranch && button.dataset.dashboardNetwork === network;
			const selected = onNetwork &&
				(client ? button.dataset.dashboardClient === client : !button.dataset.dashboardClient);
			attr(button, 'aria-current', selected ? 'true' : null);
			if (node.item)
				node.item.classList.toggle('dashboard-topology-selected', onNetwork && (!client || selected));
		}
		let first, last;
		for (const branch of this.branches.values()) {
			if (!first || branch.index < first.index)
				first = branch;
			if (!last || branch.index > last.index)
				last = branch;
			const selected = branch === selectedBranch;
			const target = client ? branch.visibleClients.indexOf(client) : -1;
			const midpoint = (branch.rowCount - 1) / 2;
			const start = client ? Math.min(midpoint, Math.max(0, target)) : 0;
			const length = client ? Math.abs(midpoint - Math.max(0, target)) : branch.rowCount - 1;
			branch.item.classList.toggle('dashboard-topology-selected', selected);
			branch.item.classList.toggle('dashboard-topology-client-path', selected && (!client || target >= 0));
			branch.moreItem.classList.toggle('dashboard-topology-selected', selected && !client);
			branch.emptyItem.classList.toggle('dashboard-topology-selected', selected && !client);
			attr(branch.clients, 'style', '--topology-path-start:' + start + ';--topology-path-length:' + length +
				';--topology-mobile-path-end:' + (client ? Math.max(0, target) : branch.rowCount - 1));
		}
		const midpoint = Math.max(0, this.rowCount - 1) / 2;
		const target = selectedBranch ? selectedBranch.rowStart + (selectedBranch.rowCount - 1) / 2 : midpoint;
		attr(this.networks, 'style', '--topology-first:' + ((first?.rowCount - 1) / 2 || 0) +
			';--topology-last:' + ((last?.rowCount - 1) / 2 || 0) +
			';--topology-path-start:' + Math.min(midpoint, target) + ';--topology-path-length:' + Math.abs(midpoint - target) +
			';--topology-mobile-end-rows:' + (last?.rowStart || 0) + ';--topology-mobile-end-branches:' + (last?.index || 0) +
			';--topology-mobile-path-rows:' + (selectedBranch?.rowStart || 0) + ';--topology-mobile-path-branches:' + (selectedBranch?.index || 0));
		this.networks.classList.toggle('dashboard-topology-selected', !!selectedBranch);
		this.upstreams.classList.toggle('dashboard-topology-selected', !!selectedBranch);
		this.router.classList.toggle('dashboard-topology-selected', !!selectedBranch);
	},

	render() {
		return { charts: [ { id: 'network_path_preview', node: () => { this.init(); return this.node; } } ] };
	}
});
