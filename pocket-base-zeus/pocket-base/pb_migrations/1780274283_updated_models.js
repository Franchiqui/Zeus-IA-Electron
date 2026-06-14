/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("6zsfy21nhwtnwma")

  // add field
  collection.fields.addAt(7, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3870925373",
    "max": 0,
    "min": 0,
    "name": "modelName",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "number3267775688",
    "max": null,
    "min": null,
    "name": "topP",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(9, new Field({
    "hidden": false,
    "id": "number1043015411",
    "max": null,
    "min": null,
    "name": "frequencyPenalty",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "number1962795223",
    "max": null,
    "min": null,
    "name": "presencePenalty",
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
  collection.fields.removeById("text3870925373")

  // remove field
  collection.fields.removeById("number3267775688")

  // remove field
  collection.fields.removeById("number1043015411")

  // remove field
  collection.fields.removeById("number1962795223")

  return app.save(collection)
})
