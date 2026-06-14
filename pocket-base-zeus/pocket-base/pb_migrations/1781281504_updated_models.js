/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("6zsfy21nhwtnwma")

  // add field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "number587793568",
    "max": null,
    "min": null,
    "name": "tamano",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("6zsfy21nhwtnwma")

  // remove field
  collection.fields.removeById("number587793568")

  return app.save(collection)
})
