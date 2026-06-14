/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("6zsfy21nhwtnwma")

  // remove field
  collection.fields.removeById("als0g8xe")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("6zsfy21nhwtnwma")

  // add field
  collection.fields.addAt(1, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "als0g8xe",
    "max": 0,
    "min": 0,
    "name": "name",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
})
