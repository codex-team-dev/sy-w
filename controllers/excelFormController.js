const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/AppError');

const User = require('./../models/userModel');
const Code = require('./../models/codeModel');

const express = require('express');
const fs = require('fs');
const XLSX = require('xlsx');
const { CLIENT_RENEG_LIMIT } = require('tls');

exports.addForm = catchAsync(async function(req, res, next) {
    const user = res.locals;

    if(!user) return res.status(400).json({
      status: 'fail',
      message: "انت غير مسجل!"
    })

    const data = {
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    fatherName: req.body.fatherName,
    motherName: req.body.motherName,
    phone: req.body.phone,
    dob: req.body.dob,
    issues: req.body.issues,
    codeProblems: req.body.codeProblems,
    satisfaction: req.body.satisfaction
  };
  // Check if Excel file exists
  let workbook;
  if (fs.existsSync('responses.xlsx')) {
    workbook = XLSX.readFile('responses.xlsx');
  } else {
    workbook = XLSX.utils.book_new();
  }

  const sheetName = 'Responses';

// ✅ If sheet exists, load it. Otherwise create a new empty sheet.
let worksheet = workbook.Sheets[sheetName];
let rows = worksheet ? XLSX.utils.sheet_to_json(worksheet) : [];

// ✅ Add the new row
rows.push(data);

// ✅ Convert updated rows back to a sheet
worksheet = XLSX.utils.json_to_sheet(rows);

// ✅ Write the sheet back into the workbook
workbook.Sheets[sheetName] = worksheet;

// ✅ Ensure sheet is listed in SheetNames
if (!workbook.SheetNames.includes(sheetName)) {
  workbook.SheetNames.push(sheetName);
}

// ✅ Save file
XLSX.writeFile(workbook, 'responses.xlsx');

  res.status(200).json({
    status: 'success',
    message: 'added sheet'
  });
})


exports.getUsers = catchAsync(async function(req, res, next) {
  const {searchMethod, searchValue} = req.body;
  
  let users = [];
  switch(searchMethod) {
    case 'All' :
    users = await User.find({}).select('+active');
    break;
    case "Name":
    const safe = String(searchValue ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    users = await User.find({name: {$regex: safe, $options: 'i'}}).select('+active')
    break;
    case "Code":
    const code = await Code.findOne({code: searchValue});

    if(!code) {
      return res.status(400).json({
        status: 'fail',
        message: 'الكود خاطئ'
      })
    }

    if(code.activated === false) {

      return res.status(400).json({
        status: 'fail',
        message: 'الكود غير مفعل'
      })
    }
    users = [await User.findById(code.activatedBy).select('+active')];
    break;
  }

     if(users.length > 0)
      res.status(200).json({
      status: 'success',
      users
     })

     else
      res.status(400).json({
    status: 'fail',
  message: 'لا نتائج'})
})

// -3LgK6Ngi5AY