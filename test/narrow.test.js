const Ui = require('../lib/ui')
const Path = require('path')
const settings = require('../lib/settings')

const {
  reopen,
  getNarrowForProvider,
  ensureEditor,
  ensurePaneLayout,
  dispatchEditorCommand,
  getActiveEditor,
  paneForItem,
  // setActiveTextEditor,
  setActiveTextEditorWithWaits,
  unindent,
  emitterEventPromise
} = require('./helper')
const runCommand = dispatchEditorCommand
const $ = unindent

const appleGrapeLemmonText = $`
  apple
  grape
  lemmon
  `

// Main
// -------------------------
describe('narrow', () => {
  let editor, service, workspaceElement
  function startNarrow (name, options) {
    return service.narrow(name, options).then(getNarrowForProvider)
  }

  beforeEach(async () => {
    // workaround BUG in 1.25.0-beta2
    atom.config.resetUserSettings({})

    workspaceElement = atom.workspace.getElement()
    document.body.appendChild(workspaceElement)
    document.body.focus()

    // `destroyEmptyPanes` is default true, but atom's spec-helper reset to `false`
    // So set it to `true` again here to test with default value.
    atom.config.set('core.destroyEmptyPanes', true)
    editor = await atom.workspace.open()

    const activationPromise = atom.packages.activatePackage('narrow')
    atom.commands.dispatch(atom.workspace.getElement(), 'narrow:activate-package')
    const pkg = await activationPromise
    service = pkg.mainModule.provideNarrow()
  })

  afterEach(() => {
    atom.workspace.getTextEditors().forEach(editor => editor.destroy())
    workspaceElement.remove()
    Ui.reset()
    Ui.forEach(ui => ui.destroy())
  })

  describe('confirm family', () => {
    let narrow
    beforeEach(async () => {
      editor.setText(appleGrapeLemmonText)
      editor.setCursorBufferPosition([0, 0])
      narrow = await startNarrow('scan')
      await narrow.ensure('l', {
        text: $`
          l
          apple
          lemmon
          `,
        selectedItemRow: 1
      })
    })

    describe('closeOnConfirm settings', () => {
      it('land to confirmed item and close narrow-editor', async () => {
        settings.set('Scan.closeOnConfirm', true)
        runCommand('core:confirm')
        await narrow.promiseForUiEvent('did-destroy')
        ensureEditor(editor, {cursor: [0, 3]})
        assert(Ui.getSize() === 0)
      })

      it('land to confirmed item and keep open narrow-editor', async () => {
        settings.set('Scan.closeOnConfirm', false)
        runCommand('core:confirm')
        await narrow.promiseForUiEvent('did-confirm')
        ensureEditor(editor, {cursor: [0, 3]})
        assert(Ui.getSize() === 1)
      })
    })

    describe('confirm-keep-open command', () => {
      it('land to confirmed item and keep open narrow-editor even if closeOnConfirm was true', async () => {
        settings.set('Scan.closeOnConfirm', true)
        runCommand('narrow-ui:confirm-keep-open')
        await narrow.promiseForUiEvent('did-confirm')
        ensureEditor(editor, {cursor: [0, 3]})
        assert(Ui.getSize() === 1)
      })
    })
  })

  describe('narrow-editor open/close', () => {
    function getBottomDockActiveItem () {
      return atom.workspace.getBottomDock().getActivePaneItem()
    }
    function getCenterActiveItem () {
      return atom.workspace.getCenter().getActivePaneItem()
    }

    beforeEach(() => {
      editor.setText(appleGrapeLemmonText)
      editor.setCursorBufferPosition([0, 0])
    })

    describe('[bottom] open/close in bottom dock', () => {
      it('open narow-editor at dock and can close by `core:close`', async () => {
        const narrow = await startNarrow('scan')
        const dockActiveItem = getBottomDockActiveItem()
        assert(dockActiveItem === narrow.ui.editor)
        const destroyPromise = narrow.promiseForUiEvent('did-destroy')
        atom.commands.dispatch(dockActiveItem.element, 'core:close')
        await destroyPromise
        assert(narrow.ui.destroyed === true)
        assert(getBottomDockActiveItem() === undefined)
      })
    })

    describe('[bottom/center] narrow-ui:relocate command', () => {
      it('open narow-editor at dock and can close by `core:close`', async () => {
        const narrow = await startNarrow('scan')

        const ensureLocation = (location, item) => {
          assert(narrow.ui.narrowEditor.getLocation() === location)
          assert(narrow.ui.editor.element.hasFocus())
          assert(item === narrow.ui.editor)
        }

        ensureLocation('bottom', getBottomDockActiveItem())

        atom.commands.dispatch(narrow.ui.editor.element, 'narrow-ui:relocate')
        ensureLocation('center', getCenterActiveItem())
        assert(getBottomDockActiveItem() === undefined)

        atom.commands.dispatch(narrow.ui.editor.element, 'narrow-ui:relocate')
        ensureLocation('bottom', getBottomDockActiveItem())

        atom.commands.dispatch(narrow.ui.editor.element, 'narrow-ui:relocate')
        ensureLocation('center', getCenterActiveItem())
        assert(getBottomDockActiveItem() === undefined)
      })
    })
    describe('[center location] split settings', () => {
      beforeEach(() => {
        atom.config.set('narrow.locationToOpen', 'center')
      })
      describe('from one pane', () => {
        beforeEach(() => {
          ensurePaneLayout([editor])
        })

        it('open on right pane', async () => {
          settings.set('split', 'right')
          const {ui} = await startNarrow('scan')
          ensurePaneLayout({horizontal: [[editor], [ui.editor]]})
        })

        it('open on down pane', async () => {
          settings.set('split', 'down')
          const {ui} = await startNarrow('scan')
          ensurePaneLayout({vertical: [[editor], [ui.editor]]})
        })
      })

      describe('from two pane', () => {
        beforeEach(() => {
          settings.set('split', 'right')
        })

        describe('horizontal split', () => {
          let editor2
          beforeEach(() =>
            atom.workspace.open(null, {split: 'right'}).then(_editor => {
              editor2 = _editor
              ensurePaneLayout({horizontal: [[editor], [editor2]]})
            })
          )

          describe('initially left-pane active', () => {
            it('open on existing right pane', async () => {
              paneForItem(editor).activate()
              assert(editor.element.hasFocus())
              const {ui} = await startNarrow('scan')
              ensurePaneLayout({horizontal: [[editor], [editor2, ui.editor]]})
            })
          })

          describe('initially right-pane active', () => {
            it('open on previous adjacent pane', async () => {
              assert(editor2.element.hasFocus())
              const {ui} = await startNarrow('scan')
              ensurePaneLayout({horizontal: [[editor, ui.editor], [editor2]]})
            })
          })
        })

        describe('vertical split', () => {
          let editor2

          beforeEach(() =>
            atom.workspace.open(null, {split: 'down'}).then(_editor => {
              editor2 = _editor
              ensurePaneLayout({vertical: [[editor], [editor2]]})
            })
          )

          describe('initially ip-pane active', () => {
            it('open on existing down pane', async () => {
              paneForItem(editor).activate()
              assert(editor.element.hasFocus())
              const {ui} = await startNarrow('scan')
              ensurePaneLayout({vertical: [[editor], [editor2, ui.editor]]})
            })
          })

          describe('initially iown pane active', () => {
            it('open on previous adjacent pane', async () => {
              assert(editor2.element.hasFocus())
              const {ui} = await startNarrow('scan')
              ensurePaneLayout({vertical: [[editor, ui.editor], [editor2]]})
            })
          })
        })
      })
    })
  })

  describe('narrow:focus', () => {
    beforeEach(() => {
      editor.setText(appleGrapeLemmonText)
      editor.setCursorBufferPosition([0, 0])
    })

    it('toggle focus between provider.editor and ui.editor', async () => {
      const narrow = await startNarrow('scan')
      assert(narrow.ui.editor.element.hasFocus())
      runCommand('narrow:focus')
      assert(editor.element.hasFocus())
      runCommand('narrow:focus')
      assert(narrow.ui.editor.element.hasFocus())
      runCommand('narrow:focus')
      assert(editor.element.hasFocus())
    })
  })

  describe('narrow:focus-prompt', () => {
    beforeEach(() => {
      editor.setText(appleGrapeLemmonText)
      editor.setCursorBufferPosition([0, 0])
    })

    it('toggle focus between provider.editor and ui.editor', async () => {
      const {ensure, ui} = await startNarrow('scan')
      ui.editor.setCursorBufferPosition([1, 0])

      assert(ui.editor.element.hasFocus())
      await ensure({cursor: [1, 0], selectedItemRow: 1})

      runCommand('narrow:focus-prompt')
      assert(ui.editor.element.hasFocus())
      await ensure({cursor: [0, 0], selectedItemRow: 1})

      // focus provider.editor
      runCommand('narrow:focus-prompt')
      assert(editor.element.hasFocus())
      await ensure({cursor: [0, 0], selectedItemRow: 1})

      // focus narrow-editor
      runCommand('narrow:focus-prompt')
      assert(ui.editor.element.hasFocus())
      await ensure({cursor: [0, 0], selectedItemRow: 1})
    })
  })

  describe('narrow:close', () => {
    beforeEach(() => {
      editor.setText(appleGrapeLemmonText)
      editor.setCursorBufferPosition([0, 0])
    })

    it('close narrow-editor from outside of narrow-editor', async () => {
      await startNarrow('scan')
      assert(atom.workspace.getTextEditors().length === 2)
      // setActiveTextEditor(editor)
      editor.element.focus()

      assert(editor.element.hasFocus())
      runCommand('narrow:close')
      assert(editor.element.hasFocus())
      assert(atom.workspace.getTextEditors().length === 1)
    })

    it('continue close until no narrow-editor is exists', async () => {
      await startNarrow('scan')
      await startNarrow('scan')
      await startNarrow('scan')
      await startNarrow('scan')

      assert(Ui.getSize() === 4)
      // setActiveTextEditor(editor)
      editor.element.focus()
      assert(editor.element.hasFocus())

      const closeAndEnsureSize = size => {
        runCommand('narrow:close')
        assert(Ui.getSize() === size)
      }
      closeAndEnsureSize(3)
      closeAndEnsureSize(2)
      closeAndEnsureSize(1)
      closeAndEnsureSize(0)
      closeAndEnsureSize(0)
    })
  })

  describe('narrow:refresh', () => {
    beforeEach(() => {
      editor.setText(appleGrapeLemmonText)
      editor.setCursorBufferPosition([0, 0])
    })

    it('redraw items when item area was mutated', async () => {
      const narrow = await startNarrow('scan')
      const originalText = narrow.ui.editor.getText()

      const eof = narrow.ui.editor.getEofBufferPosition()
      narrow.ui.editor.setTextInBufferRange([[1, 0], eof], 'abc\ndef\n')
      await narrow.ensure({text: '\nabc\ndef\n'})

      runCommand('narrow:refresh')
      await narrow.promiseForUiEvent('did-refresh')
      await narrow.ensure({text: originalText})
    })
  })

  describe('reopen', () => {
    // prettier-ignore
    it('reopen closed narrow editor up to 10 recent', async () => {
      const ensureUiSize = size => assert(Ui.getSize() === size)
      const ensureText = text => assert(getActiveEditor().getText() === text)
      const narrows = []

      editor.setText('1\n2\n3\n4\n5\n6\n7\n8\n9\na\nb')
      editor.setCursorBufferPosition([0, 0])
      for (let i = 0; i <= 10; i++) {
        narrows.push(await startNarrow('scan'))
      }

      ensureUiSize(11)
      await narrows[0].ensure('1', {text: '1\n1'})
      await narrows[1].ensure('2', {text: '2\n2'})
      await narrows[2].ensure('3', {text: '3\n3'})
      await narrows[3].ensure('4', {text: '4\n4'})
      await narrows[4].ensure('5', {text: '5\n5'})
      await narrows[5].ensure('6', {text: '6\n6'})
      await narrows[6].ensure('7', {text: '7\n7'})
      await narrows[7].ensure('8', {text: '8\n8'})
      await narrows[8].ensure('9', {text: '9\n9'})
      await narrows[9].ensure('a', {text: 'a\na'})
      await narrows[10].ensure('b', {text: 'b\nb'})
      for (const {ui} of narrows) ui.destroy()
      ensureUiSize(0)
      await reopen(); ensureText('b\nb'); ensureUiSize(1)
      await reopen(); ensureText('a\na'); ensureUiSize(2)
      await reopen(); ensureText('9\n9'); ensureUiSize(3)
      await reopen(); ensureText('8\n8'); ensureUiSize(4)
      await reopen(); ensureText('7\n7'); ensureUiSize(5)
      await reopen(); ensureText('6\n6'); ensureUiSize(6)
      await reopen(); ensureText('5\n5'); ensureUiSize(7)
      await reopen(); ensureText('4\n4'); ensureUiSize(8)
      await reopen(); ensureText('3\n3'); ensureUiSize(9)
      await reopen(); ensureText('2\n2'); ensureUiSize(10)

      assert(!reopen())
      ensureUiSize(10)
    })
  })

  describe('narrow:next-item, narrow:previous-item', () => {
    describe('basic behavior', () => {
      beforeEach(() => {
        editor.setText(appleGrapeLemmonText)
        editor.setCursorBufferPosition([0, 0])
      })

      // prettier-ignore
      it('move to next/previous item with wrap', async () => {
        const confirmCommand = (narrow, command) => {
          runCommand('narrow:' + command)
          return narrow.promiseForUiEvent('did-confirm')
        }

        const narrow = await startNarrow('scan')
        await narrow.ensure('p', {
          text: $`
              p
              apple
              apple
              grape
              `
        })
        const confirm = confirmCommand.bind(null, narrow)

        // setActiveTextEditor(editor)
        editor.element.focus()
        assert(editor.element.hasFocus())
        ensureEditor(editor, {cursor: [0, 0]})

        await confirm('next-item'); ensureEditor(editor, {cursor: [0, 1]})
        await confirm('next-item'); ensureEditor(editor, {cursor: [0, 2]})

        await confirm('next-item'); ensureEditor(editor, {cursor: [1, 3]})
        await confirm('next-item'); ensureEditor(editor, {cursor: [0, 1]})

        await confirm('previous-item'); ensureEditor(editor, {cursor: [1, 3]})
        await confirm('previous-item'); ensureEditor(editor, {cursor: [0, 2]})
        await confirm('previous-item'); ensureEditor(editor, {cursor: [0, 1]})
      })
    })

    describe('when cursor position is contained in item.range', () => {
      let narrow
      beforeEach(async () => {
        editor.setText($`
            line 1
              line 2
            line 3
              line 4
            `)
        editor.setCursorBufferPosition([0, 0])
        narrow = await startNarrow('scan')
        await narrow.ensure('line', {
          text: $`
              line
              line 1
                line 2
              line 3
                line 4
              `
        })
      })

      it('move to next/previous', async () => {
        await setActiveTextEditorWithWaits(editor)

        const r1 = [[0, 0], [0, 3]] // `line` range of "line 1"
        const r2 = [[1, 2], [1, 6]] // `line` range of "  line 2"
        const r3 = [[2, 0], [2, 3]] // `line` range of "line 3"
        const r4 = [[3, 2], [3, 6]] // `line` range of "  line 4"

        const ensureCommand = async (command, start, last) => {
          editor.setCursorBufferPosition(start)
          runCommand('narrow:' + command.trim())
          await narrow.promiseForUiEvent('did-confirm')
          ensureEditor(editor, {cursor: last})
        }

        await ensureCommand('next-item    ', r1[0], [1, 2])
        await ensureCommand('next-item    ', r1[1], [1, 2])
        await ensureCommand('previous-item', r1[0], [3, 2])
        await ensureCommand('previous-item', r1[1], [3, 2])
        await ensureCommand('next-item    ', r2[0], [2, 0])
        await ensureCommand('next-item    ', r2[1], [2, 0])
        await ensureCommand('previous-item', r2[0], [0, 0])
        await ensureCommand('previous-item', r2[1], [0, 0])
        await ensureCommand('next-item    ', r3[0], [3, 2])
        await ensureCommand('next-item    ', r3[1], [3, 2])
        await ensureCommand('previous-item', r3[0], [1, 2])
        await ensureCommand('previous-item', r3[1], [1, 2])
        await ensureCommand('next-item    ', r4[0], [0, 0])
        await ensureCommand('next-item    ', r4[1], [0, 0])
        await ensureCommand('previous-item', r4[0], [2, 0])
        await ensureCommand('previous-item', r4[1], [2, 0])
      })
    })
  })

  describe('auto reveal on start behavior( revealOnStartCondition )', () => {
    let points, pointsA

    const getEnsureStartState = startOptions => async (point, options) => {
      editor.setCursorBufferPosition(point)
      const narrow = await startNarrow('scan', startOptions)
      await narrow.ensure(options)
      narrow.ui.destroy()
    }

    beforeEach(() => {
      points = [
        [0, 0], // `line` start of "line 1"
        [1, 2], // `line` start of "  line 2"
        [2, 0], // `line` start of "line 3"
        [3, 2] // `line` start of "  line 4"
      ]
      // prettier-ignore
      pointsA = [
          [1, 0],
          [2, 2],
          [3, 0],
          [4, 2]
      ]

      editor.setText($`
          line 1
            line 2
          line 3
            line 4
          `)
      editor.setCursorBufferPosition([0, 0])
    })

    describe('revealOnStartCondition = on-input( default )', () => {
      beforeEach(() => {
        settings.set('Scan.revealOnStartCondition', 'on-input')
      })

      it('auto reveal when initial query was provided', async () => {
        const text = $`
            line
            line 1
              line 2
            line 3
              line 4
            `
        const ensureStartState = getEnsureStartState({queryCurrentWord: true})
        await ensureStartState(points[0], {cursor: pointsA[0], text, selectedItemText: 'line 1'})
        await ensureStartState(points[1], {cursor: pointsA[1], text, selectedItemText: '  line 2'})
        await ensureStartState(points[2], {cursor: pointsA[2], text, selectedItemText: 'line 3'})
        await ensureStartState(points[3], {cursor: pointsA[3], text, selectedItemText: '  line 4'})
      })

      it('NOT auto reveal when no query was provided', async () => {
        const text = $`

            line 1
              line 2
            line 3
              line 4
            `
        const ensureStartState = getEnsureStartState()
        const options = {selectedItemText: 'line 1', cursor: [0, 0], text}
        for (const point of points) {
          await ensureStartState(point, options)
        }
      })
    })

    describe('revealOnStartCondition = never', () => {
      beforeEach(() => {
        settings.set('Scan.revealOnStartCondition', 'never')
      })

      it('NOT auto reveal when initial query was provided', async () => {
        const text = $`
            line
            line 1
              line 2
            line 3
              line 4
            `
        const ensureStartState = getEnsureStartState({queryCurrentWord: true})
        const options = {selectedItemText: 'line 1', cursor: [0, 4], text}
        for (const point of points) {
          await ensureStartState(point, options)
        }
      })

      it('NOT auto reveal when no query was provided', async () => {
        const text = $`

            line 1
              line 2
            line 3
              line 4
            `
        const ensureStartState = getEnsureStartState()
        const options = {selectedItemText: 'line 1', cursor: [0, 0], text}
        for (const point of points) {
          await ensureStartState(point, options)
        }
      })
    })

    describe('revealOnStartCondition = always', () => {
      beforeEach(() => {
        settings.set('Scan.revealOnStartCondition', 'always')
      })

      it('auto reveal when initial query was provided', async () => {
        const text = $`
            line
            line 1
              line 2
            line 3
              line 4
            `
        const ensureStartState = getEnsureStartState({queryCurrentWord: true})
        await ensureStartState(points[0], {cursor: pointsA[0], text, selectedItemText: 'line 1'})
        await ensureStartState(points[1], {cursor: pointsA[1], text, selectedItemText: '  line 2'})
        await ensureStartState(points[2], {cursor: pointsA[2], text, selectedItemText: 'line 3'})
        await ensureStartState(points[3], {cursor: pointsA[3], text, selectedItemText: '  line 4'})
      })

      it('auto reveal when initial query was provided when multiple match on same line', async () => {
        const lineText = 'line line line line'
        editor.setText(lineText)

        const text = $`
            line
            line line line line
            line line line line
            line line line line
            line line line line
            `
        const ensureStartState = getEnsureStartState({queryCurrentWord: true})
        points = [[0, 0], [0, 5], [0, 10], [0, 15]]
        pointsA = [[1, 0], [2, 5], [3, 10], [4, 15]]

        const selectedItemText = lineText
        for (let i = 0; i < points.length; i++) {
          await ensureStartState(points[i], {cursor: pointsA[i], text, selectedItemText})
        }
      })

      it('auto reveal for based on current line of bound-editor', async () => {
        const text = $`

            line 1
              line 2
            line 3
              line 4
            `
        const ensureStartState = getEnsureStartState()
        await ensureStartState([0, 0], {cursor: [1, 0], text, selectedItemText: 'line 1'})
        await ensureStartState([1, 2], {cursor: [2, 0], text, selectedItemText: '  line 2'})
        await ensureStartState([2, 0], {cursor: [3, 0], text, selectedItemText: 'line 3'})
        await ensureStartState([3, 2], {cursor: [4, 0], text, selectedItemText: '  line 4'})
      })
    })
  })

  describe('narrow-editor auto-sync selected-item to active editor', () => {
    let narrow, editor2

    beforeEach(async () => {
      editor.setText($`
          line 1

          line 3

          line 5

          line 7

          line 9

          `)
      editor.setCursorBufferPosition([0, 0])

      editor2 = await atom.workspace.open()
      editor2.setText($`

          line 2

          line 4

          line 6

          line 8

          line 10
          `)
      editor2.setCursorBufferPosition([0, 0])

      assert(editor2.element.hasFocus())
      narrow = await startNarrow('scan')
      assert(narrow.ui.editor.element.hasFocus())
      assert(narrow.provider.editor === editor2)
      await narrow.ensure('line', {
        text: $`
            line
            line 2
            line 4
            line 6
            line 8
            line 10
            `
      })
    })

    describe('re-bound to active text-editor', () =>
      it('provider.editor is rebound to active text-editor and auto-refreshed', async () => {
        const {provider, ensure} = narrow

        await setActiveTextEditorWithWaits(editor)

        assert(editor.element.hasFocus())
        assert(provider.editor === editor)
        await ensure({
          text: $`
            line
            line 1
            line 3
            line 5
            line 7
            line 9
            `
        })
        const refreshPromise = narrow.promiseForUiEvent('did-refresh')
        await setActiveTextEditorWithWaits(editor2)
        await refreshPromise
        assert(provider.editor === editor2)
        await ensure({
          text: $`
            line
            line 2
            line 4
            line 6
            line 8
            line 10
            `
        })
      }))

    describe("auto-sync selected-item to acitive-editor's cursor position", () =>
      // prettier-ignore
      it('provider.editor is bound to active text-editor and auto-refreshed', async () => {
        const {provider, ensure} = narrow
        const setCursor = (editor, point) => editor.setCursorBufferPosition(point)

        await setActiveTextEditorWithWaits(editor)

        assert(editor.element.hasFocus())
        assert(provider.editor === editor)

        setCursor(editor, [0, 0]); await ensure({selectedItemText: 'line 1'})
        setCursor(editor, [1, 0]); await ensure({selectedItemText: 'line 1'})
        setCursor(editor, [2, 0]); await ensure({selectedItemText: 'line 3'})
        setCursor(editor, [3, 0]); await ensure({selectedItemText: 'line 3'})
        setCursor(editor, [4, 0]); await ensure({selectedItemText: 'line 5'})
        editor.moveToBottom()
        ensureEditor(editor, {cursor: [9, 0]})
        await ensure({selectedItemText: 'line 9'})

        await setActiveTextEditorWithWaits(editor2)

        assert(provider.editor === editor2)
        await ensure({selectedItemText: 'line 2'})
        setCursor(editor2, [1, 0]); await ensure({selectedItemText: 'line 2'})
        setCursor(editor2, [3, 0]); await ensure({selectedItemText: 'line 4'})
        setCursor(editor2, [5, 0]); await ensure({selectedItemText: 'line 6'})
        setCursor(editor2, [7, 0]); await ensure({selectedItemText: 'line 8'})

        editor2.moveToTop()
        ensureEditor(editor2, {cursor: [0, 0]})
        await ensure({selectedItemText: 'line 2'})
      }))
  })

  describe('scan', () => {
    describe('with empty query', () => {
      let narrow

      beforeEach(async () => {
        editor.setText(appleGrapeLemmonText)
        editor.setCursorBufferPosition([0, 0])
        narrow = await startNarrow('scan')
      })

      it('add css class to narrowEditorElement', async () => {
        await narrow.ensure({classListContains: ['narrow', 'narrow-editor', 'scan']})
      })

      it('initial state is whole buffer lines', async () => {
        await narrow.ensure({
          text: $`

              apple
              grape
              lemmon
              `
        })
      })

      it('can filter by query', async () => {
        await narrow.ensure('app', {
          text: $`
              app
              apple
              `,
          selectedItemRow: 1,
          itemsCount: 1
        })

        await narrow.ensure('r', {
          text: $`
              r
              grape
              `,
          selectedItemRow: 1,
          itemsCount: 1
        })

        await narrow.ensure('l', {
          text: $`
              l
              apple
              lemmon
              `,
          selectedItemRow: 1,
          itemsCount: 2
        })
      })

      it('land to confirmed item', async () => {
        await narrow.ensure('l', {
          text: $`
              l
              apple
              lemmon
              `,
          selectedItemRow: 1
        })

        runCommand('core:confirm')
        await narrow.promiseForUiEvent('did-destroy')
        ensureEditor(editor, {cursor: [0, 3]})
      })

      it('land to confirmed item', async () => {
        await narrow.ensure('mm', {
          text: $`
              mm
              lemmon
              `,
          selectedItemRow: 1
        })

        runCommand('core:confirm')
        await narrow.promiseForUiEvent('did-destroy')
        ensureEditor(editor, {cursor: [2, 2]})
      })
    })

    describe('with queryCurrentWord', () => {
      beforeEach(() => {
        editor.setText(appleGrapeLemmonText)
      })

      const ensureScan = async (point, option) => {
        // setActiveTextEditor(editor)
        editor.element.focus()
        editor.setCursorBufferPosition(point)
        const narrow = await startNarrow('scan', {queryCurrentWord: true})
        await narrow.ensure(option)
        narrow.ui.destroy()
      }

      it('set current-word as initial query', async () => {
        await ensureScan([0, 0], {
          text: $`
              apple
              apple
              `,
          selectedItemRow: 1,
          itemsCount: 1
        })

        await ensureScan([1, 0], {
          text: $`
              grape
              grape
              `,
          selectedItemRow: 1,
          itemsCount: 1
        })

        await ensureScan([2, 0], {
          text: $`
              lemmon
              lemmon
              `,
          selectedItemRow: 1,
          itemsCount: 1
        })
      })
    })
  })

  describe('search', () => {
    let p1, p1f1, p1f2, p1f3
    let p2, p2f1, p2f2
    beforeEach(() => {
      settings.set('projectHeaderTemplate', '# __HEADER__')
      settings.set('fileHeaderTemplate', '## __HEADER__')

      p1 = Path.join(__dirname, 'fixtures', 'project1')
      p2 = Path.join(__dirname, 'fixtures', 'project2')
      p1f1 = Path.join(p1, 'p1-f1')
      p1f2 = Path.join(p1, 'p1-f2')
      p1f3 = Path.join(p1, 'p1-f3.php')
      p2f1 = Path.join(p2, 'p2-f1')
      p2f2 = Path.join(p2, 'p2-f2')

      const fixturesDir = Path.join(__dirname, 'fixtures')

      atom.project.removePath(fixturesDir)
      atom.project.addPath(p1)
      atom.project.addPath(p2)
    })

    describe('basic behavior', () => {
      let narrow, ui, ensure
      beforeEach(async () => {
        narrow = await startNarrow('search', {query: 'apple'})
        ui = narrow.ui
        ensure = narrow.ensure
        await narrow.promiseForUiEvent('did-preview')
      })

      it('preview on cursor move with skipping header', async () => {
        const runPreviewCommand = command => {
          runCommand(command)
          return narrow.promiseForUiEvent('did-preview')
        }

        await ensure({
          text: $`
            apple
            # project1
            ## p1-f1
            p1-f1: apple
            ## p1-f2
            p1-f2: apple
            # project2
            ## p2-f1
            p2-f1: apple
            ## p2-f2
            p2-f2: apple
            `,
          cursor: [3, 7],
          selectedItemText: 'p1-f1: apple'
        })

        runCommand('core:move-up')
        await ensure({selectedItemText: 'p1-f1: apple', cursor: [0, 5]})

        await runPreviewCommand('core:move-down')
        await ensure({
          selectedItemText: 'p1-f1: apple',
          cursor: [3, 7],
          filePathForProviderPane: p1f1
        })

        await runPreviewCommand('core:move-down')
        await ensure({
          selectedItemText: 'p1-f2: apple',
          cursor: [5, 7],
          filePathForProviderPane: p1f2
        })
        assert(ui.editor.element.hasFocus())

        await runPreviewCommand('core:move-down')
        await ensure({
          selectedItemText: 'p2-f1: apple',
          cursor: [8, 7],
          filePathForProviderPane: p2f1
        })

        await runPreviewCommand('core:move-down')
        await ensure({
          selectedItemText: 'p2-f2: apple',
          cursor: [10, 7],
          filePathForProviderPane: p2f2
        })
      })

      it('preview on query change by default( autoPreviewOnQueryChange )', async () => {
        narrow.ui.moveToPrompt()
        narrow.ui.editor.insertText(' f2')
        await narrow.promiseForUiEvent('did-preview')
        await ensure({
          text: $`
            apple f2
            # project1
            ## p1-f2
            p1-f2: apple
            # project2
            ## p2-f2
            p2-f2: apple
            `,
          selectedItemText: 'p1-f2: apple',
          filePathForProviderPane: p1f2
        })

        ui.editor.insertText(' p2')
        await narrow.promiseForUiEvent('did-preview')
        await ensure({
          text: $`
              apple f2 p2
              # project2
              ## p2-f2
              p2-f2: apple
              `,
          selectedItemText: 'p2-f2: apple',
          filePathForProviderPane: p2f2
        })
      })

      it('can filter files by select-files provider', async () => {
        await ensure({
          text: $`
              apple
              # project1
              ## p1-f1
              p1-f1: apple
              ## p1-f2
              p1-f2: apple
              # project2
              ## p2-f1
              p2-f1: apple
              ## p2-f2
              p2-f2: apple
              `,
          cursor: [3, 7],
          selectedItemText: 'p1-f1: apple'
        })

        // Section0: Move to selected file.
        {
          const selectFiles = getNarrowForProvider(await ui.selectFiles())
          await selectFiles.ensure({
            text: $`

              project1/p1-f1
              project1/p1-f2
              project2/p2-f1
              project2/p2-f2
              `
          })

          assert(selectFiles.ui.editor.element.hasFocus())
          const promise = emitterEventPromise(selectFiles.ui.emitter, 'did-destroy')
          runCommand('core:move-down')
          runCommand('core:move-down') // Move to file "project1/p1-f2"
          runCommand('core:confirm')
          await promise

          // Ensure f1 matching files are excluded and not listed in narrow-editor.
          assert(ui.editor.element.hasFocus())
          assert.deepEqual(ui.excludedFiles, [])
          await ensure({
            text: $`
              apple
              # project1
              ## p1-f1
              p1-f1: apple
              ## p1-f2
              p1-f2: apple
              # project2
              ## p2-f1
              p2-f1: apple
              ## p2-f2
              p2-f2: apple
              `,
            cursor: [5, 7],
            selectedItemText: 'p1-f2: apple'
          })
        }

        // Section1
        {
          const selectFiles = getNarrowForProvider(await ui.selectFiles())
          await selectFiles.ensure({
            text: $`

              project1/p1-f1
              project1/p1-f2
              project2/p2-f1
              project2/p2-f2
              `
          })

          await selectFiles.ensure('f1', {
            text: $`
              f1
              project1/p1-f1
              project2/p2-f1
              `
          })

          await selectFiles.ensure('f1!', {
            text: $`
              f1!
              project1/p1-f2
              project2/p2-f2
              `
          })

          assert(selectFiles.ui.editor.element.hasFocus())

          const promise = emitterEventPromise(selectFiles.ui.emitter, 'did-destroy')
          runCommand('core:confirm')
          await promise

          // Ensure f1 matching files are excluded and not listed in narrow-editor.
          assert(ui.editor.element.hasFocus())
          assert.deepEqual(ui.excludedFiles, [])
          await ensure({
            text: $`
              apple
              # project1
              ## p1-f2
              p1-f2: apple
              # project2
              ## p2-f2
              p2-f2: apple
              `,
            cursor: [3, 7],
            selectedItemText: 'p1-f2: apple'
          })
        }

        // Section2
        {
          const selectFiles = getNarrowForProvider(await ui.selectFiles())

          // selectFiles query are remembered until closing narrow-editor.
          await selectFiles.ensure({
            text: $`
              f1!
              project1/p1-f2
              project2/p2-f2
              `
          })

          // clear the file filter query
          selectFiles.ui.editor.deleteToBeginningOfLine()
          await emitterEventPromise(selectFiles.ui.emitter, 'did-refresh')

          // now all files are listable.
          selectFiles.ensure({
            text: $`

              project1/p1-f1
              project1/p1-f2
              project2/p2-f1
              project2/p2-f2
              `
          })

          const promise = emitterEventPromise(selectFiles.ui.emitter, 'did-destroy')
          runCommand('core:confirm')
          await promise

          // ensure items for all files are listed and previously selected items are preserveed.
          assert(ui.editor.element.hasFocus())
          assert.deepEqual(ui.excludedFiles, [])
          ensure({
            text: $`
              apple
              # project1
              ## p1-f1
              p1-f1: apple
              ## p1-f2
              p1-f2: apple
              # project2
              ## p2-f1
              p2-f1: apple
              ## p2-f2
              p2-f2: apple
              `,
            cursor: [3, 7],
            selectedItemText: 'p1-f1: apple'
          })
        }
      })
    })

    describe('searchCurrentWord with variable-includes-special-char language, PHP', async () => {
      const ensureFindPHPVar = narrow => {
        assert(narrow.ui.editor.element.hasFocus())
        assert.deepEqual(narrow.ui.excludedFiles, [])
        narrow.ensure({
          text: $`
            $file
            # project1
            ## p1-f3.php
            $file = "p1-f3.php";
            # project2
            ## p2-f3.php
            $file = "p2-f3.php";
            `,
          cursor: [3, 0],
          selectedItemText: '$file = "p1-f3.php";'
        })
      }
      const ensureSearch = provider => startNarrow(provider, {queryCurrentWord: true}).then(ensureFindPHPVar)

      beforeEach(async () => {
        await atom.packages.activatePackage('language-php')
        const editor = await atom.workspace.open(p1f3)
        editor.setCursorBufferPosition([1, 0])
      })

      it('[atom-scan]', async () => {
        await ensureSearch('atom-scan')
      })

      it('search with ag', async () => {
        settings.set('Search.searcher', 'ag')
        await ensureSearch('search')
      })

      it('search with rg', async () => {
        settings.set('Search.searcher', 'rg')
        await ensureSearch('search')
      })
    })

    describe('search regex special char include search term', () => {
      const ensureByProvider = async (name, query, ensureOptions) => {
        const narrow = await startNarrow(name, {query})
        await narrow.ensure(ensureOptions)
      }

      describe('search project1/p1-f', () => {
        const query = 'project1/p1-f'

        const textA = $`
          project1/p1-f
          # project1
          ## p1-f1
          path: project1/p1-f1
          ## p1-f2
          path: project1/p1-f2
          `

        const textB = $`
          project1/p1-f
          # project1
          ## p1-f2
          path: project1/p1-f2
          ## p1-f1
          path: project1/p1-f1
          `

        const ensureOptions = {
          textAndSelectedItemTextOneOf: [
            {text: textA, selectedItemText: 'path: project1/p1-f1'},
            {text: textB, selectedItemText: 'path: project1/p1-f2'}
          ],
          cursor: [3, 6]
        }

        it('[atom-scan]', async () => {
          await ensureByProvider('atom-scan', query, ensureOptions)
        })

        it('[search:ag]', async () => {
          settings.set('Search.searcher', 'ag')
          await ensureByProvider('atom-scan', query, ensureOptions)
        })

        it('[search:rg]', async () => {
          settings.set('Search.searcher', 'rg')
          await ensureByProvider('atom-scan', query, ensureOptions)
        })
      })

      describe('search a/b/c', () => {
        const query = 'a/b/c'

        const textA = $`
          a/b/c
          # project1
          ## p1-f1
          path: a/b/c
          ## p1-f2
          path: a/b/c
          `

        const textB = $`
          a/b/c
          # project1
          ## p1-f2
          path: a/b/c
          ## p1-f1
          path: a/b/c
          `

        const ensureOptions = {
          textAndSelectedItemTextOneOf: [
            {text: textA, selectedItemText: 'path: a/b/c'},
            {text: textB, selectedItemText: 'path: a/b/c'}
          ],
          cursor: [3, 6]
        }

        it('[atom-scan]', async () => {
          await ensureByProvider('atom-scan', query, ensureOptions)
        })

        it('[search:ag]', async () => {
          settings.set('Search.searcher', 'ag')
          await ensureByProvider('search', query, ensureOptions)
        })

        it('[search:rg]', async () => {
          settings.set('Search.searcher', 'rg')
          await ensureByProvider('search', query, ensureOptions)
        })
      })

      describe('search a/b/c', () => {
        let query = 'a\\/b\\/c'

        const textA = $`
          a\\/b\\/c
          # project1
          ## p1-f1
          path: a\\/b\\/c
          ## p1-f2
          path: a\\/b\\/c
          `

        const textB = $`
          a\\/b\\/c
          # project1
          ## p1-f2
          path: a\\/b\\/c
          ## p1-f1
          path: a\\/b\\/c
          `

        const ensureOptions = {
          textAndSelectedItemTextOneOf: [
            {text: textA, selectedItemText: 'path: a\\/b\\/c'},
            {text: textB, selectedItemText: 'path: a\\/b\\/c'}
          ],
          cursor: [3, 6]
        }

        it('[atom-scan]', async () => {
          await ensureByProvider('atom-scan', query, ensureOptions)
        })

        it('[search:ag]', async () => {
          settings.set('Search.searcher', 'ag')
          await ensureByProvider('search', query, ensureOptions)
        })

        it('[search:rg]', async () => {
          settings.set('Search.searcher', 'rg')
          await ensureByProvider('search', query, ensureOptions)
        })
      })
    })
  })
})
