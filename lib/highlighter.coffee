{CompositeDisposable, Point, Range} = require 'atom'

{
  getVisibleEditors
  isNarrowEditor
  cloneRegExp
  isNormalItem
} = require './utils'

module.exports =
class Highlighter
  regExp: null
  lineMarker: null

  highlightNarrowEditor: ->
    return unless @regExp

    editor = @ui.editor

    if @markerLayerForUi?
      @markerLayerForUi.clear()
    else
      @markerLayerForUi = editor.addMarkerLayer()
      decorationOptions = {type: 'highlight', class: 'narrow-match-ui'}
      @decorationLayerForUi = editor.decorateMarkerLayer(@markerLayerForUi, decorationOptions)

    for line, row in editor.buffer.getLines() when isNormalItem(item = @ui.items.getItemForRow(row))
      {start, end} = item.range.translate([0, item._lineHeader.length])
      range = [[row, start.column], [row, end.column]]
      @markerLayerForUi.markBufferRange(range, invalidate: 'inside')

  constructor: (@ui) ->
    @provider = @ui.provider
    @needHighlight = @provider.itemHaveRange

    @markerLayerByEditor = new Map()
    @decorationLayerByEditor = new Map()

    @subscriptions = new CompositeDisposable
    subscribe = (disposable) => @subscriptions.add(disposable)

    if @needHighlight
      subscribe @ui.onDidRefresh =>
        # console.log 'did-refresh'
        unless @ui.grammar.searchRegex?
          @highlightNarrowEditor()

        if @provider.boundToSingleFile
          @refreshAll()

      unless @provider.boundToSingleFile
        subscribe @ui.onDidStopRefreshing =>
          # console.log 'did-stop-refresh'
          @refreshAll()
          item = @ui.items.selectedItem
          if item?
            @highlightCurrentForEditor(@ui.provider.editor, item)

    subscribe @ui.onDidConfirm =>
      @clearCurrentAndLineMarker()

    subscribe @ui.onDidPreview ({editor, item}) =>
      # console.log 'did-preview'
      @clearCurrentAndLineMarker()
      if @needHighlight
        @highlight(editor)
        @highlightCurrentForEditor(editor, item)
      @drawLineMarker(editor, item)

  setRegExp: (@regExp) ->

  destroy: ->
    @markerLayerForUi?.destroy()
    @decorationLayerForUi?.destroy()
    @clear()
    @clearCurrentAndLineMarker()
    @subscriptions.dispose()

  # Highlight items
  # -------------------------
  refreshAll: ->
    @clear()
    @highlight(editor) for editor in getVisibleEditors()

  clear: ->
    @markerLayerByEditor.forEach (markerLayer) -> markerLayer.destroy()
    @markerLayerByEditor.clear()

    @decorationLayerByEditor.forEach (decorationLayer) -> decorationLayer.destroy()
    @decorationLayerByEditor.clear()

  decorationOptions = {type: 'highlight', class: 'narrow-match'}
  highlight: (editor) ->
    return unless @regExp
    return if @markerLayerByEditor.has(editor)
    return if isNarrowEditor(editor)
    return if @provider.boundToSingleFile and editor isnt @provider.editor

    items = @ui.getNormalItemsForEditor(editor)
    if items.length
      @markerLayerByEditor.set(editor, markerLayer = editor.addMarkerLayer())
      @decorationLayerByEditor.set(editor, editor.decorateMarkerLayer(markerLayer, decorationOptions))
      for item in items when range = item.range
        markerLayer.markBufferRange(range, invalidate: 'inside')

  clearCurrentAndLineMarker: ->
    @clearLineMarker()
    @clearCurrent()

  # modify current item decoration
  # -------------------------
  highlightCurrentForEditor: (editor, {range}) ->
    startBufferRow = range.start.row
    if decorationLayer = @decorationLayerByEditor.get(editor)
      for marker in decorationLayer.getMarkerLayer().findMarkers({startBufferRow})
        if marker.getBufferRange().isEqual(range)
          newProperties = {type: 'highlight', class: 'narrow-match current'}
          decorationLayer.setPropertiesForMarker(marker, newProperties)
          @selectedMarkerEditor = editor
          @selectedItemMarker = marker

  clearCurrent: ->
    if @selectedMarkerEditor?
      if decorationLayer = @decorationLayerByEditor.get(@selectedMarkerEditor)
        decorationLayer.setPropertiesForMarker(@selectedItemMarker, null)
      @selectedMarkerEditor = null
      @selectedItemMarker = null

  # line marker
  # -------------------------
  hasLineMarker: ->
    @lineMarker?

  drawLineMarker: (editor, item) ->
    @lineMarker = editor.markBufferPosition(item.point)
    editor.decorateMarker(@lineMarker, type: 'line', class: 'narrow-line-marker')

  clearLineMarker: ->
    @lineMarker?.destroy()
    @lineMarker = null

  # flash
  # -------------------------
  clearFlashMarker: ->
    clearTimeout(@clearFlashTimeoutID) if @clearFlashTimeoutID?
    @clearFlashTimeoutID = null
    @flashMarker?.destroy()
    @flashMarker = null

  flashItem: (editor, item) ->
    return unless @needHighlight
    @clearFlashMarker()
    @flashMarker = editor.markBufferRange(item.range)
    editor.decorateMarker(@flashMarker, type: 'highlight', class: 'narrow-match flash')
    @clearFlashTimeoutID = setTimeout(@clearFlashMarker.bind(this), 1000)
