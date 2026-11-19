import concurrent.futures
import hashlib
from pathlib import Path
import tempfile
import unittest

from manage import STATES, manage


class PoolTest(unittest.TestCase):
    def test_allocation_and_revocation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for state in STATES:
                (root / state).mkdir()
            (root / 'origin').write_text('https://example.org:8443')

            def claim(employee):
                owner = hashlib.sha256(employee.encode()).hexdigest()
                return manage(root, {'action': 'claim', 'owner': owner, 'employee': employee})

            self.assertEqual(claim('alice'), {'error': 'empty'})
            self.assertEqual(manage(root, {'action': 'fill'}), {'generated': 100})
            self.assertEqual(manage(root, {'action': 'fill'}), {'generated': 0})
            with concurrent.futures.ThreadPoolExecutor(4) as pool:
                results = list(pool.map(claim, ['alice'] * 4 + ['bob']))
            self.assertTrue(all(item == results[0] for item in results[:4]))
            self.assertNotEqual(results[0]['url'], results[4]['url'])
            items = manage(root, {'action': 'list'})['items']
            alice = next(item for item in items if item['employee'] == 'alice')
            key = results[0]['url'].split('/')[-2]
            self.assertNotIn(key, str(items))
            self.assertIn(key[-8:], alice['address_preview'])
            self.assertEqual(manage(root, {'action': 'address', 'id': alice['id']}), results[0])
            self.assertTrue((root / 'assigned' / key).is_file())
            manage(root, {'action': 'revoke', 'id': alice['id']})
            self.assertFalse((root / 'assigned' / key).exists())
            self.assertEqual(claim('alice'), {'error': 'revoked'})
            self.assertEqual(claim('bob'), results[4])

    def test_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for state in STATES:
                (root / state).mkdir()
            (root / 'origin').write_text('https://example.org:8443')
            links = ['https://example.org:8443/sub/' + format(i, '064x') + '/clash.yaml'
                     for i in range(100)]

            def upload(text):
                return manage(root, {'action': 'import', 'text': text})

            self.assertEqual(upload('\n'), {'error': 'empty_import'})
            self.assertEqual(upload(links[0] + '\n\n' + links[1].replace('example.org', 'elsewhere.org')),
                             {'error': 'invalid_address', 'line': 3})
            self.assertEqual(upload('\n'.join([links[0]] * 1001)), {'error': 'import_size'})
            self.assertEqual(list((root / 'available').iterdir()), [])
            self.assertEqual(upload(links[0]), {'added': 1, 'skipped': 0})
            self.assertEqual(upload('\ufeff' + '\r\n'.join(links + [links[0]])),
                             {'added': 99, 'skipped': 2})
            alice = {'action': 'claim', 'owner': 'a'*64, 'employee': 'Alice'}
            self.assertEqual(manage(root, alice)['url'], links[0])
            self.assertEqual(upload(links[0]), {'added': 0, 'skipped': 1})
            self.assertEqual(manage(root, alice)['url'], links[0])
            manage(root, {'action': 'revoke', 'id': 1})
            self.assertEqual(upload(links[0]), {'added': 0, 'skipped': 1})
            self.assertEqual(manage(root, alice), {'error': 'revoked'})
