"""Offline only: mocked ARM metadata, transports, keys and recovery state."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('azure_verifier_test_target', ROOT / 'scripts/verify-azure.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
RUN = '11111111-1111-4111-8111-111111111111'


def args():
    return SimpleNamespace(subscription=M.SUBSCRIPTION, resource_group=M.RESOURCE_GROUP, prelaunch=True, expected_region='westus3',
                           api_app='melzi-api-321fe2d1', housekeeping_app='melzi-housekeeping-321fe2d1', verification_app='melzi-verification-321fe2d1',
                           postgres_server='melzi-pg-321fe2d1', static_app='melzi-research-site', origin='https://melzi.dev', recover=None, cleanup_abandoned=False, browser_cleanup=False)


class Fake(M.AzureVerifier):
    def __init__(self):
        super().__init__(args())
        self.calls = []
        group = self.group_id
        self.metadata = {group: {'id': group, 'tags': dict(M.TAGS), 'location': 'westus2'}}
        self.setting_values = {}
        vnet = group + '/providers/Microsoft.Network/virtualNetworks/research'
        pg_id = group + '/providers/Microsoft.DBforPostgreSQL/flexibleServers/' + self.args.postgres_server
        self.metadata[pg_id] = {'id': pg_id, 'tags': dict(M.TAGS), 'location': 'westus3', 'sku': {'name': 'Standard_B1ms'}, 'properties': {
            'version': '17', 'fullyQualifiedDomainName': 'research.postgres.database.azure.com', 'storage': {'storageSizeGB': 32},
            'network': {'publicNetworkAccess': 'Disabled', 'delegatedSubnetResourceId': vnet + '/subnets/postgres'}}}
        self.pg_id = pg_id
        site = group + '/providers/Microsoft.Web/staticSites/' + self.args.static_app
        self.metadata[site] = {'id': site, 'tags': dict(M.TAGS), 'location': 'westus2', 'sku': {'tier': 'Free'}, 'properties': {'defaultHostname': 'research.azurestaticapps.net'}}
        self.metadata[site + '/builds'] = {'value': []}
        for role in ('api', 'housekeeping', 'verification'):
            name = getattr(self.args, role + '_app')
            identifier = group + '/providers/Microsoft.Web/sites/' + name
            self.metadata[identifier] = {'id': identifier, 'name': name, 'tags': dict(M.TAGS), 'location': 'westus3',
                'identity': {'principalId': role + '-principal'}, 'properties': {'state': 'Running', 'httpsOnly': True,
                'defaultHostName': name + '.azurewebsites.net', 'virtualNetworkSubnetId': vnet + '/subnets/functions',
                'functionAppConfig': {'runtime': {'name': 'node', 'version': '22'}, 'scaleAndConcurrency': {'instanceMemoryMB': 512,
                'maximumInstanceCount': 1, 'alwaysReady': [], 'triggers': {'http': {'perInstanceConcurrency': 1}}}}}}
            fname = {'api': 'researchDraft', 'housekeeping': 'researchHousekeeping', 'verification': 'researchVerification'}[role]
            trigger = {'type': 'timerTrigger', 'schedule': '0 0 * * * *'} if role == 'housekeeping' else {'type': 'httpTrigger',
                'route': 'v1/draft' if role == 'api' else 'verify', 'methods': ['GET', 'POST', 'PUT', 'OPTIONS'] if role == 'api' else ['POST'],
                'authLevel': 'anonymous' if role == 'api' else 'function'}
            self.metadata[identifier + '/functions'] = {'value': [{'name': name + '/' + fname, 'properties': {'config': {'bindings': [trigger]}}}]}
            self.setting_values[name] = {'CLOUD_PROVIDER': 'azure', 'PGHOST': 'research.postgres.database.azure.com', 'PGDATABASE': 'melzi_research',
                'PGUSER': 'melzi_research_app', 'PGPORT': '5432', 'API_RESOURCE_ID': self.api_id, 'ALLOWED_ORIGINS': 'https://melzi.dev',
                'VERIFICATION_RUN_ID': RUN, 'FUNCTIONS_REQUEST_BODY_SIZE_LIMIT': '65536'}
        self.metadata[self.api_id + '/config/web'] = {'properties': {'cors': {'allowedOrigins': []}}}
        self.metadata[self.api_id + '/config/authsettingsV2'] = {'properties': {'platform': {'enabled': False}}}
        self.control_actions = None
        self.verifier_control = False
        self.role_scope = self.api_id

    def rest(self, resource, **kwargs):
        self.calls.append(('rest', resource, kwargs))
        return copy.deepcopy(self.metadata[resource])

    def app_settings(self, name):
        return dict(self.setting_values[name])

    def az(self, *command, **kwargs):
        self.calls.append(command)
        if command[:2] == ('account', 'show'):
            return {'id': M.SUBSCRIPTION, 'state': 'Enabled'}
        if command[:3] == ('role', 'assignment', 'list'):
            principal = command[command.index('--assignee') + 1]
            base = '/subscriptions/' + M.SUBSCRIPTION + '/providers/Microsoft.Authorization/roleDefinitions/'
            role_id = '33333333-3333-4333-8333-333333333333' if principal == 'housekeeping-principal' else RUN
            control = [{'principalId': principal, 'scope': self.role_scope, 'roleDefinitionId': base + role_id}] if principal != 'verification-principal' or self.verifier_control else []
            return control + [{'principalId': principal, 'scope': self.group_id + '/providers/Microsoft.Storage/storageAccounts/test', 'roleDefinitionId': base + '22222222-2222-4222-8222-222222222222'}]
        if command[0] == 'rest':
            url = command[command.index('--url') + 1]
            exact = ['Microsoft.Web/sites/read', 'Microsoft.Web/sites/stop/action'] + (['Microsoft.Web/sites/start/action'] if '33333333-' in url else [])
            actions = ['Microsoft.Storage/storageAccounts/blobServices/containers/*'] if '22222222-' in url else self.control_actions if self.control_actions is not None else exact
            return {'properties': {'permissions': [{'actions': actions}]}}
        if command[:3] == ('functionapp', 'keys', 'list'):
            return 'synthetic-private-function-key' if command[command.index('--query') + 1] == 'functionKeys.default' else 'synthetic-private-master-key'
        raise AssertionError('unexpected fake command')


class GuardTests(unittest.TestCase):
    def test_exact_tags_westus3_workloads_and_westus2_group_static_are_accepted(self):
        v = Fake()
        v.guards(full=True)
        self.assertTrue(v.owned)
        self.assertEqual(v.run_id, RUN)
        self.assertFalse(any(call[:3] == ('functionapp', 'keys', 'list') for call in v.calls))

    def test_wrong_owner_private_network_region_and_scale_fail_before_keys(self):
        changes = [
            lambda v: v.metadata[v.api_id]['tags'].update(application='another-project'),
            lambda v: v.metadata[v.api_id].update(location='westus2'),
            lambda v: v.metadata[v.pg_id]['properties']['network'].update(publicNetworkAccess='Enabled'),
            lambda v: v.metadata[v.api_id]['properties']['functionAppConfig']['scaleAndConcurrency'].update(maximumInstanceCount=40),
            lambda v: v.setting_values[v.args.api_app].update(PGUSER='admin'),
            lambda v: v.metadata[v.api_id + '/config/web']['properties']['cors'].update(allowedOrigins=['*']),
            lambda v: v.metadata[v.api_id + '/config/authsettingsV2']['properties']['platform'].update(enabled=True),
            lambda v: v.metadata[v.api_id]['properties'].update(virtualNetworkSubnetId='/outside/subnets/functions'),
            lambda v: v.setting_values[v.args.verification_app].update(VERIFICATION_RUN_ID='not-a-uuid'),
        ]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                v = Fake()
                change(v)
                with self.assertRaises(M.Failure):
                    v.guards(full=True)
                self.assertFalse(any(call[:3] == ('functionapp', 'keys', 'list') for call in v.calls))

    def test_broad_web_role_is_rejected_but_storage_wildcards_are_not_misclassified(self):
        v = Fake()
        v.guards(full=True)
        for actions in [['*'], ['Microsoft.Web/sites/*'], ['Microsoft.Web/sites/delete']]:
            v = Fake()
            v.control_actions = actions
            with self.assertRaises(M.Failure):
                v.guards(full=True)
        v = Fake()
        v.role_scope = v.group_id
        with self.assertRaises(M.Failure):
            v.guards(full=True)

    def test_api_start_verifier_control_and_shared_identity_are_rejected(self):
        v = Fake()
        v.control_actions = ['Microsoft.Web/sites/read', 'Microsoft.Web/sites/start/action', 'Microsoft.Web/sites/stop/action']
        with self.assertRaises(M.Failure):
            v.guards(full=True)
        v = Fake()
        v.verifier_control = True
        with self.assertRaises(M.Failure):
            v.guards(full=True)
        v = Fake()
        verifier_id = v.group_id + '/providers/Microsoft.Web/sites/' + v.args.verification_app
        v.metadata[verifier_id]['identity']['principalId'] = 'api-principal'
        with self.assertRaises(M.Failure):
            v.guards(full=True)

    def test_timer_must_not_have_public_http_trigger(self):
        v = Fake()
        identifier = v.group_id + '/providers/Microsoft.Web/sites/' + v.args.housekeeping_app
        v.metadata[identifier + '/functions']['value'][0]['properties']['config']['bindings'] = [{'type': 'httpTrigger'}]
        with self.assertRaises(M.Failure):
            v.guards(full=True)

    def test_keys_are_memory_only_and_not_passed_in_cli_arguments(self):
        v = Fake()
        v.guards(full=True)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            v.keys()
        self.assertEqual(v.verification_key, 'synthetic-private-function-key')
        self.assertEqual(v.housekeeping_key, 'synthetic-private-master-key')
        self.assertNotIn('synthetic-private', repr(v.calls))
        self.assertEqual(output.getvalue(), '')

    def test_sanitized_cli_errors_and_redirect_policy(self):
        self.assertEqual(M.safe_azure_error('ERROR: (AuthorizationFailed) private-password', 1), 'AuthorizationFailed')
        self.assertEqual(M.safe_azure_error('private-password', 3), 'CLIExit3')
        self.assertIsNone(M.NoRedirect().redirect_request(None))

    def test_http_does_not_allow_key_in_url_or_unverified_host(self):
        v = Fake()
        v.allowed_hosts = {'safe.azurewebsites.net'}
        for host, path in [('evil.example', '/api/verify'), ('safe.azurewebsites.net', '/api/verify?code=secret')]:
            with self.assertRaises(M.Failure):
                v.http(host, path)

    def test_subscription_prelaunch_and_distinct_apps_are_mandatory(self):
        base = ['--origin', 'https://melzi.dev', '--outputs', '/nonexistent/azure-outputs.json', '--api-app', 'test-api',
                '--housekeeping-app', 'test-housekeeping', '--verification-app', 'test-verification', '--postgres-server', 'test-postgres', '--static-app', 'test-static']
        with contextlib.redirect_stderr(io.StringIO()):
            for extra in [[], ['--prelaunch', '--subscription', 'wrong'], ['--prelaunch', '--resource-group', 'other']]:
                with self.assertRaises(SystemExit):
                    M.arguments(base + extra)
        self.assertEqual(M.arguments(base + ['--prelaunch']).expected_region, 'westus3')


class BrowserCleanupTests(unittest.TestCase):
    def test_published_swa_cleanup_uses_only_verifier_function_key(self):
        v = Fake()
        v.args.prelaunch = False
        v.args.browser_cleanup = True
        site = v.group_id + '/providers/Microsoft.Web/staticSites/' + v.args.static_app
        v.metadata[site + '/builds'] = {'value': [{'properties': {'status': 'Ready'}}]}
        with tempfile.TemporaryDirectory() as directory:
            v.receipt_directory = Path(directory)
            with contextlib.redirect_stdout(io.StringIO()):
                v.cleanup_abandoned()
        key_calls = [call for call in v.calls if call[:3] == ('functionapp', 'keys', 'list')]
        self.assertEqual(len(key_calls), 1)
        self.assertEqual(key_calls[0][key_calls[0].index('--name') + 1], v.args.verification_app)
        self.assertEqual(key_calls[0][key_calls[0].index('--query') + 1], 'functionKeys.default')
        self.assertIsNone(v.housekeeping_key)

    def test_browser_cleanup_cannot_call_quota_api_timer_or_arm_mutations(self):
        v = Fake()
        v.args.browser_cleanup = True
        v.args.prelaunch = False
        v.guards(full=True)
        forbidden = [lambda: v.snapshot(), lambda: v.api('GET'), lambda: v.housekeeping(), lambda: v.api_action('start'),
                     lambda: v.api_action('stop'), lambda: v.quota_tests(), lambda: v.restore_budget(),
                     lambda: v.private('armQuota'), lambda: v.private('quotaSnapshot'), lambda: v.private('restoreSnapshot'),
                     lambda: M.AzureVerifier.rest(v, v.api_id + '/stop', method='post')]
        for operation in forbidden:
            with self.assertRaises(M.Failure):
                operation()
        for command in [('rest', '--method', 'post', '--url', M.ARM + v.api_id + '/stop'),
                        ('role', 'assignment', 'create'), ('functionapp', 'delete'),
                        ('functionapp', 'config', 'appsettings', 'set'),
                        ('functionapp', 'keys', 'list', '--name', v.args.housekeeping_app, '--query', 'masterKey')]:
            with patch.object(M.subprocess, 'run', side_effect=AssertionError('must not execute')), self.assertRaises(M.Failure):
                M.AzureVerifier.az(v, *command)

    def test_existing_quota_receipt_prevents_browser_cleanup_before_keys(self):
        v = Fake()
        v.args.browser_cleanup = True
        v.args.prelaunch = False
        with tempfile.TemporaryDirectory() as directory:
            v.receipt_directory = Path(directory)
            (Path(directory) / (RUN + '.json')).write_text('{}')
            with self.assertRaises(M.Failure):
                v.cleanup_abandoned()
        self.assertFalse(any(call[:3] == ('functionapp', 'keys', 'list') for call in v.calls))

    def test_full_prelaunch_guard_still_rejects_published_swa(self):
        v = Fake()
        site = v.group_id + '/providers/Microsoft.Web/staticSites/' + v.args.static_app
        v.metadata[site + '/builds'] = {'value': [{'properties': {'status': 'Ready'}}]}
        v.http = lambda *_args, **_kwargs: (200, {}, {}, b'Published real application')
        with self.assertRaises(M.Failure):
            v.guards(full=True)


class RecoveryTests(unittest.TestCase):
    def budget(self):
        return {'day': '2026-10-04', 'today': {'day': '2026-10-04', 'requests': 12, 'observed_invocations': 12,
                'writes': 4, 'creates': 1, 'auto_closed': False}, 'yesterday': None, 'proof': 'a' * 64}

    def test_receipt_permissions_and_no_bearer_answer_or_fixture_proof(self):
        with tempfile.TemporaryDirectory() as directory:
            v = Fake()
            v.guards(full=True)
            v.receipt_directory = Path(directory) / 'receipts'
            v.receipt = v.receipt_directory / (RUN + '.json')
            v.original_snapshot = self.budget()
            v.api_state = 'Running'
            v.fixture_proof = 'synthetic-private-fixture-proof'
            v.save_receipt('armed')
            value = v.receipt.read_text()
            self.assertEqual(stat.S_IMODE(v.receipt.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(v.receipt_directory.stat().st_mode), 0o700)
            for secret in [v.token, v.token_hash, v.fixture_proof]:
                self.assertNotIn(secret, value)
            self.assertEqual(json.loads(value)['originalSnapshot'], v.original_snapshot)

    def test_restore_stabilizes_api_then_restores_all_counters_and_original_state(self):
        v = Fake()
        v.original_snapshot = self.budget()
        damaged = copy.deepcopy(v.original_snapshot)
        damaged['today']['requests'] = 10000
        damaged['today']['observed_invocations'] = 15
        events = []
        values = [damaged, v.original_snapshot]
        v.guards = lambda **kw: events.append('guard')
        v.api_action = lambda action: events.append(action)
        v.snapshot = lambda: values.pop(0)
        v.api_state = 'Running'
        v.state = lambda: 'Running'
        v.private = lambda action, **fields: (events.append(action) or {'snapshot': fields['snapshot']})
        with contextlib.redirect_stdout(io.StringIO()):
            v.restore_budget()
        self.assertEqual(events, ['guard', 'stop', 'restoreSnapshot', 'start'])
        self.assertFalse(v.quota_started)
        self.assertIsNone(v.original_snapshot)

    def test_sigterm_attempts_finally_cleanup(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            class Terminated:
                def __init__(self, _args):
                    self.receipt_directory = Path(directory) / 'private'
                    self.failed = 0
                    self.count = 0
                def run(self):
                    os.kill(os.getpid(), signal.SIGTERM)
                def finish(self):
                    events.append('cleanup')
            with patch.object(M, 'AzureVerifier', Terminated), patch.object(M, 'arguments', return_value=args()), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(M.main([]), 1)
        self.assertEqual(events, ['cleanup'])

    def test_failed_assertions_do_not_signal_temporary_app_deletion(self):
        v = Fake()
        v.guards(full=True)
        v.keys()
        v.failed = 1
        v.guards = lambda **kwargs: None
        v.private = lambda *_args, **_kwargs: {'deletedDrafts': 0, 'retiredTombstonesRetained': True, 'quotaStateNotModified': True}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            v.finish()
        self.assertNotIn('ready for infrastructure-owner removal', output.getvalue())
        self.assertIn('preserve verifier', output.getvalue())


class QuotaProofTests(unittest.TestCase):
    def scenario(self, unexpected_execution=False, lost_marker=False):
        v = Fake()
        v.guards(full=True)
        original = RecoveryTests().budget()
        current = copy.deepcopy(original)
        state = ['Running']
        events = []
        v.guards = lambda **kwargs: None
        v.save_receipt = lambda phase: events.append(phase)
        v.snapshot = lambda: copy.deepcopy(current)
        v.wait_state = lambda expected: state[0] == expected
        v.state = lambda: state[0]
        def private(action, **fields):
            if action == 'armQuota':
                current['today']['requests'] = 9999
            elif action == 'prepareRollover':
                current['today']['requests'] = 12
                current['today']['auto_closed'] = False
                current['yesterday'] = {'auto_closed': True}
            else:
                raise AssertionError(action)
            return {'snapshot': copy.deepcopy(current)}
        v.private = private
        def http(*_args, **_kwargs):
            if current['today']['requests'] == 9999:
                events.append('public-self-stop')
                current['today'].update(requests=10000, observed_invocations=13, auto_closed=not lost_marker)
                state[0] = 'Stopped'
                return 503, {}, {}, b''
            if unexpected_execution:
                current['today']['observed_invocations'] += 1
            return 403, {}, {}, b''
        v.http = http
        def housekeeping():
            events.append('timer-invoked')
            if (current.get('yesterday') or {}).get('auto_closed'):
                current['yesterday']['auto_closed'] = False
                state[0] = 'Running'
            return {'ok': True}
        v.housekeeping = housekeeping
        v.api = lambda *_args, **_kwargs: (410, {})
        v.restore_budget = lambda: events.append('root-cleanup-only')
        return v, events

    def test_proof_uses_public_self_stop_before_any_root_cleanup_operation(self):
        v, events = self.scenario()
        with contextlib.redirect_stdout(io.StringIO()):
            v.quota_tests()
        self.assertLess(events.index('public-self-stop'), events.index('root-cleanup-only'))
        self.assertEqual(events.count('timer-invoked'), 1)
        self.assertLess(events.index('rollover-prepared'), events.index('timer-invoked'))

    def test_capped_requests_alone_do_not_pass_when_stopped_probes_execute(self):
        v, events = self.scenario(unexpected_execution=True)
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(M.Failure):
            v.quota_tests()
        self.assertNotIn('root-cleanup-only', events)

    def test_worker_termination_without_committed_marker_is_not_a_pass(self):
        v, _ = self.scenario(lost_marker=True)
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(M.Failure):
            v.quota_tests()


if __name__ == '__main__':
    unittest.main(verbosity=2)
