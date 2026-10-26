// The repository names no game, franchise or publisher. The words to keep
// out are stored as code points, so this file does not spell them either.
//
//   bun test tools/checks

import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const word = (...codes: number[]) => String.fromCodePoint(...codes)
const ascii = (...letters: string[]) => letters.join('')

const DENY = [
  word(0x91e3, 0x9b5a, 0x592a, 0x90ce),
  word(0x306c, 0x3057, 0x91e3),
  word(0x4e3b, 0x91e3, 0x308a),
  word(0x5ddd, 0x306e),
  ascii('ri', 'ver ', 'king'),
  ascii('ka', 'wa no ', 'nu', 'shi'),
  ascii('nu', 'shi'),
  ascii('mar', 'velous'),
  ascii('pa', 'ck-in'),
  ascii('nat', 'sume'),
]

const git = (...args: string[]) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' })
const BINARY = /\.(png|wav|jpg|jpeg|gif|ico|ttf|ttc|otf)$/i

test('no tracked file names or holds a denied word', () => {
  const hits: string[] = []
  for (const path of git('ls-files', '-z').split('\0').filter(Boolean)) {
    const haystacks = [path.toLowerCase()]
    if (!BINARY.test(path)) haystacks.push(readFileSync(join(ROOT, path), 'utf8').toLowerCase())
    for (const denied of DENY) {
      if (haystacks.some(text => text.includes(denied))) hits.push(`${path}: word #${DENY.indexOf(denied) + 1}`)
    }
  }
  expect(hits).toEqual([])
})

test('no commit message holds a denied word', () => {
  const log = git('log', '--format=%H %B').toLowerCase()
  expect(DENY.filter(denied => log.includes(denied)).map(denied => `word #${DENY.indexOf(denied) + 1}`)).toEqual([])
})

test('no commit message carries a co-author or tool attribution line', () => {
  const log = git('log', '--format=%B')
  expect(log.match(/co-author|generated with/gi) ?? []).toEqual([])
})
